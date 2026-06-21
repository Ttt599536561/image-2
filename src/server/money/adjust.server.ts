// ★server-only：管理员调积分（真相源 09 §10.3）。±均用正数 amount_mp + 方向标记。
//   增 → 建 source='adjust' 批次 + 物化余额 +delta；减 → FIFO 锁批次扣 |delta| 不出负 + 物化余额 -moved。
//
// 🔴 adjust 红线（防对账反转）：必须「同一事务内同时改 credit_lots（增=建批次 / 减=FIFO 扣 remaining）与物化余额」——
//   绝不只动物化余额（否则对账 cron 以 SUM(lots) 为准把它当漂移修回、悄悄抵消本次 adjust）。
//   账本 amount_mp / events.amountMp / 审计 before·after 一律取「本次真实移动量 moved」与 RETURNING 真值；
//   ref_id=admin_id（text）与 user_id（uuid）分参；balance_mp 的 CHECK>=0 是不出负最后防线。
import { type TxClient, tx } from "../tx.server";

export interface AdjustInput {
  adminId: string;
  userId: string;
  deltaMp: number; // 可负、≠0
  reason: string; // 必填
  validDays?: number | null; // 仅增额生效；NULL=永久
  ip?: string | null;
}

export interface AdjustResult {
  moved: number; // 本次真正移动的毫积分（正数）
  before: number;
  after: number;
}

async function run(c: TxClient, input: AdjustInput): Promise<AdjustResult> {
  const { adminId, userId, deltaMp, reason } = input;
  // 调整前先取真值 before（FOR UPDATE 锁账户行）。
  const acct = await c.query("SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE", [userId]);
  if (acct.rowCount === 0) throw new Error("adjust: 用户账户不存在（未 onboard）");
  const before = Number(acct.rows[0].balance_mp);

  let moved: number;
  if (deltaMp > 0) {
    // 增：建 source='adjust' 批次 + 物化余额 +delta（同步动 lots 与余额）。
    await c.query(
      `INSERT INTO credit_lots(user_id,source,code_id,granted_mp,remaining_mp,expires_at)
       VALUES($1,'adjust',NULL,$2,$2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + ($3::int * interval '1 day') END)`,
      [userId, deltaMp, input.validDays ?? null],
    );
    await c.query("UPDATE credit_accounts SET balance_mp=balance_mp+$1, updated_at=now() WHERE user_id=$2", [deltaMp, userId]);
    moved = deltaMp;
  } else {
    // 减：FIFO 锁「可用（未过期）」批次扣 |delta|，扣到 0 不出负。
    // 🔴 必须排除已过期未清批次 `AND (expires_at IS NULL OR expires_at>now())`——与 debit（03 §4.3）/对账权威
    //   SUM（10 §11.3）/余额闸（03 §4.9）口径一致。否则减额可能落在「过期 cron 尚未清零」的批次上、被对账
    //   以 SUM(未过期) 为准反转抵消（adjust 红线，09 §10.3）。
    const want = -deltaMp;
    const lots = await c.query(
      `SELECT id, remaining_mp FROM credit_lots
       WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())
       ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE`,
      [userId],
    );
    let need = want;
    for (const lot of lots.rows) {
      if (need <= 0) break;
      const take = Math.min(Number(lot.remaining_mp), need);
      await c.query("UPDATE credit_lots SET remaining_mp=remaining_mp-$1 WHERE id=$2", [take, lot.id]);
      need -= take;
    }
    moved = want - need; // 真正扣到的（≤ 请求量、绝不出负）
    if (moved > 0) {
      await c.query("UPDATE credit_accounts SET balance_mp=balance_mp-$1, updated_at=now() WHERE user_id=$2", [moved, userId]);
    }
  }

  const dir = deltaMp > 0 ? "+" : "-";
  let after = before;
  if (moved > 0) {
    // adjust 流水：amount_mp=moved（始终正）；方向落 reason 前缀；balance_after 用 RETURNING 真值。ref_id=$4=admin_id（text）。
    const led = await c.query(
      `INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,reason,ref_type,ref_id)
       VALUES($1,'adjust',$2,(SELECT balance_mp FROM credit_accounts WHERE user_id=$1),$3,'admin',$4)
       RETURNING balance_after_mp`,
      [userId, moved, `${dir} ${reason}`, adminId],
    );
    after = Number(led.rows[0].balance_after_mp);
  }

  // 审计（同事务；before/after 均为事务内真值，与 §10.6 红线一致）。admin_id=$1(uuid) / target_id=$2(text) 分参。
  await c.query(
    `INSERT INTO audit_log(admin_id,action,target_type,target_id,before,after,ip,reason)
     VALUES($1,'adjust_credit','user',$2,$3,$4,$5,$6)`,
    [adminId, userId, { balance_mp: before }, { balance_mp: after }, input.ip ?? null, reason],
  );

  // 事实事件：增→credit_granted、减→credit_consumed（按方向区分，避免污染看板「发放 vs 消耗」口径），均带 source:'adjust' 与真实 moved。
  if (moved > 0) {
    const evType = deltaMp > 0 ? "credit_granted" : "credit_consumed";
    await c.query("INSERT INTO events(type,user_id,payload) VALUES($1,$2,$3)", [
      evType,
      userId,
      { source: "adjust", amountMp: moved, direction: dir },
    ]);
  }

  return { moved, before, after };
}

/** 管理员调积分（单 Pool/WS 事务，同步动 lots + 物化余额 + ledger + audit）。 */
export async function adjustCredit(input: AdjustInput): Promise<AdjustResult> {
  if (input.deltaMp === 0) throw new Error("adjust: delta_mp 不能为 0");
  if (!input.reason?.trim()) throw new Error("adjust: reason 必填");
  return tx((c) => run(c, input));
}
