// ★server-only：兑换核销事务（真相源 03 §4.7 / 07 §8.4）。单语句原子核销 + 同事务入账 + 首兑升级顺延。
//
// 步骤：
//   1) `UPDATE redeem_codes SET status='redeemed' … WHERE code=$1 AND status='active' RETURNING`（单语句即防一码多花/并发双击）
//      0 行 → 再查 status 分 404 不存在 / 410 已用 / 410 已作废。
//   2) 建新批次（valid_days→expires_at；NULL=永久）
//   3) ledger credit（uq_credit_code 幂等）
//   4) 物化余额 +credits
//   5) 首次兑换 → has_paid=true + 旧图保留期顺延 60 天
//   6) code_redeemed 事件（收入按面值 cash_value 记账）
//
// 失败限流 5 次/10 分钟（按账号 + IP，仅计失败；07 §8.6）。本文件提供核销 + 限流读写助手，HTTP 端点（§4/§6）编排。
//
// 🔴 红线：兑换 `UPDATE…WHERE status='active' RETURNING`，affected=1 才入账；ledger ref_id=code_id（text）与
//   user_id（uuid）分参；金额整数 mp；valid_days 用 `$n::int * interval '1 day'` 避免「|| ' days'」参数类型歧义。
import type { RedeemErrorCode, RedeemResponse } from "../../contracts/redeem";
import { getSql } from "../../db/db.server";
import { type TxClient, tx } from "../tx.server";

/** 兑换业务错误（携带 HTTP 码与稳定 error.code，07 §8.4）。 */
export class RedeemError extends Error {
  code: RedeemErrorCode;
  httpStatus: number;
  constructor(code: RedeemErrorCode, httpStatus: number, message: string) {
    super(message);
    this.name = "RedeemError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

async function run(c: TxClient, userId: string, code: string): Promise<RedeemResponse> {
  // 1) 原子核销。
  const r = await c.query(
    `UPDATE redeem_codes SET status='redeemed', redeemed_by=$2, redeemed_at=now()
     WHERE code=$1 AND status='active'
     RETURNING id, credits_value_mp, cash_value, valid_days`,
    [code, userId],
  );
  if (r.rowCount === 0) {
    const s = await c.query("SELECT status FROM redeem_codes WHERE code=$1", [code]);
    if (s.rowCount === 0) throw new RedeemError("CODE_NOT_FOUND", 404, "兑换码无效");
    const st = s.rows[0].status as string;
    if (st === "redeemed") throw new RedeemError("CODE_USED", 410, "该兑换码已被使用");
    if (st === "disabled") throw new RedeemError("CODE_DISABLED", 410, "兑换码已失效");
    // 罕见竞态：恰被改回非终态 → 视为不存在（防枚举，与 404 同文案）。
    throw new RedeemError("CODE_NOT_FOUND", 404, "兑换码无效");
  }
  const codeId = r.rows[0].id as string;
  const creditsMp = Number(r.rows[0].credits_value_mp);
  const validDays = r.rows[0].valid_days as number | null;

  // 2) 建新批次（NULL valid_days = 永久）。
  await c.query(
    `INSERT INTO credit_lots(user_id,source,code_id,granted_mp,remaining_mp,expires_at)
     VALUES($1,'code',$2,$3,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4::int * interval '1 day') END)`,
    [userId, codeId, creditsMp, validDays],
  );

  // 3) ledger credit（uq_credit_code 幂等；balance_after = 当前 + credits）。ref_id=$3=code_id（text）。
  await c.query(
    `INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
     VALUES($1,'credit',$2,(SELECT balance_mp+$2 FROM credit_accounts WHERE user_id=$1),'code',$3)
     ON CONFLICT DO NOTHING`,
    [userId, creditsMp, codeId],
  );

  // 4) 物化余额 +credits。
  const acct = await c.query(
    "UPDATE credit_accounts SET balance_mp=balance_mp+$1, updated_at=now() WHERE user_id=$2 RETURNING balance_mp",
    [creditsMp, userId],
  );
  const balanceMp = Number(acct.rows[0].balance_mp);

  // 5) 首次兑换 → 升级付费 + 旧图保留期顺延 60 天（仅作用于兑换那一刻已存在的图，边界见 03 §4.7）。
  const upd = await c.query("UPDATE users SET has_paid=true, updated_at=now() WHERE id=$1 AND has_paid=false RETURNING id", [
    userId,
  ]);
  if (upd.rowCount === 1) {
    await c.query(
      `UPDATE images SET expires_at = GREATEST(COALESCE(expires_at, now()), now() + interval '60 days') WHERE user_id=$1`,
      [userId],
    );
  }

  // 6) 事实事件（收入按面值 cash_value 记账）。
  await c.query("INSERT INTO events(type,user_id,payload) VALUES('code_redeemed',$1,$2)", [
    userId,
    { codeId, creditsValueMp: creditsMp, cashValue: Number(r.rows[0].cash_value) },
  ]);

  return { balanceMp, creditsValueMp: creditsMp };
}

/** 兑换核销（单 Pool/WS 事务）。成功返回 {balanceMp, creditsValueMp}；失败抛 RedeemError（404/410）。 */
export async function redeemCode(args: { userId: string; code: string }): Promise<RedeemResponse> {
  return tx((c) => run(c, args.userId, args.code));
}

// —— 失败限流（5 次/10 分钟，按账号 + IP，仅计失败；07 §8.6）——
// 阶段二用 events 计数窗口（轻量、无需 Redis）；§4 rateLimit.ts 将统一收口。失败事件 type='redeem_failed' 不入看板聚合。
const REDEEM_FAIL_LIMIT = 5;

/** 提交前检查限流：账号或 IP 任一维度近 10 分钟失败数 ≥ 5 → 抛 RATE_LIMITED(429)。 */
export async function checkRedeemRateLimit(args: { userId: string; ip: string | null }): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM events
    WHERE type='redeem_failed' AND created_at > now() - interval '10 minutes'
      AND (user_id = ${args.userId} OR (${args.ip}::text IS NOT NULL AND payload->>'ip' = ${args.ip}))`;
  if (Number(rows[0].n) >= REDEEM_FAIL_LIMIT) {
    throw new RedeemError("RATE_LIMITED", 429, "尝试过多，请稍后再试");
  }
}

/** 记一次失败尝试（核销抛 404/410 后调用，喂限流窗口）。 */
export async function recordRedeemFailure(args: { userId: string; ip: string | null; code: RedeemErrorCode }): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO events(type,user_id,payload) VALUES('redeem_failed', ${args.userId}, ${JSON.stringify({ ip: args.ip, reason: args.code })}::jsonb)`;
}
