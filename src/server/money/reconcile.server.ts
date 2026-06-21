// ★server-only：余额对账（cron · 真相源 10 §11.3）。比对物化余额 vs 权威余额 SUM(lots.remaining 未过期)，
//   不一致 → 先告警再以批次为准修正（逐账户单语句 UPDATE，幂等、重跑收敛同值）。
//
// 🔴 红线：SUM(*_mp) 一律 `::text` + BigInt（毫积分跨 JSON 防精度丢，10 §11.4）；对账须在过期 cron 之后跑
//   （先清过期，`未过期` 口径才一致）；先告警再修正（drift 是 bug 信号，修正只兜底，根因得查事务）。
import { getSql } from "../../db/db.server";

export interface BalanceDrift {
  userId: string;
  authMp: string; // SUM(lots) string codec
  balanceMp: string; // 物化余额 string codec
  driftMp: string; // auth - balance（BigInt 计算）
}

export interface ReconcileResult {
  drifts: BalanceDrift[];
  corrected: number;
}

/** 找出所有不平账户（权威 vs 物化），以批次为准修正并写 balance_reconciled 事件。返回 drift 报告供 §7 alert 消费。 */
export async function reconcileBalances(): Promise<ReconcileResult> {
  const sql = getSql();
  // 检测：SUM 走 ::text，避免 number 精度丢失。
  const rows = await sql`
    WITH authoritative AS (
      SELECT u.id AS user_id,
             COALESCE(SUM(l.remaining_mp) FILTER (
               WHERE l.remaining_mp > 0 AND (l.expires_at IS NULL OR l.expires_at > now())
             ), 0)::text AS auth_mp
      FROM users u LEFT JOIN credit_lots l ON l.user_id = u.id
      GROUP BY u.id
    )
    SELECT a.user_id, a.auth_mp, ca.balance_mp::text AS balance_mp
    FROM authoritative a JOIN credit_accounts ca ON ca.user_id = a.user_id
    WHERE a.auth_mp::bigint <> ca.balance_mp`;

  const drifts: BalanceDrift[] = rows.map((r) => ({
    userId: r.user_id as string,
    authMp: String(r.auth_mp),
    balanceMp: String(r.balance_mp),
    driftMp: (BigInt(String(r.auth_mp)) - BigInt(String(r.balance_mp))).toString(),
  }));

  if (drifts.length === 0) return { drifts, corrected: 0 };

  // 先告警（§7 接 alert.ts；此处先落日志兜底，不静默吞）。
  console.warn(
    `[reconcile] balance_reconcile_mismatch: count=${drifts.length} sample=${JSON.stringify(drifts.slice(0, 5))}`,
  );

  // 以批次为准修正（权威 = lots 之和）。逐账户单语句 UPDATE + balance_reconciled 事件。
  let corrected = 0;
  for (const d of drifts) {
    await sql`UPDATE credit_accounts SET balance_mp=${d.authMp}::bigint, updated_at=now() WHERE user_id=${d.userId}`;
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('balance_reconciled', ${d.userId}, ${JSON.stringify({ fromMp: d.balanceMp, toMp: d.authMp, driftMp: d.driftMp })}::jsonb)`;
    corrected += 1;
  }
  return { drifts, corrected };
}
