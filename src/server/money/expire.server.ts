// ★server-only：积分过期清零（cron · 真相源 03 §4.8 / 10 §11.2）。把「到期仍有余」的批次清零 + 写 expire 流水
//   （uq_expire_lot 幂等）+ 逐笔同步物化余额。**永久批次（expires_at IS NULL）永不过期，必须跳过。**
//
// 🔴 红线：单 Pool/WS 事务 + FOR UPDATE；每 lot 的 expire 先探 uq_expire_lot（重跑跳过）；balance_after 取
//   逐笔 UPDATE…RETURNING 真值（多笔过期逐笔递减、与最终物化余额收敛）；ref_id=lot_id（text）与 user_id（uuid）分参。
import { type TxClient, tx } from "../tx.server";

export interface ExpireResult {
  expiredLots: number;
  totalMp: number;
}

async function run(c: TxClient): Promise<ExpireResult> {
  // ① 锁所有「到期且仍有余」的批次（永久批次 expires_at IS NULL 不命中）。
  const expired = await c.query(
    `SELECT id, user_id, remaining_mp FROM credit_lots
     WHERE expires_at IS NOT NULL AND expires_at < now() AND remaining_mp > 0
     FOR UPDATE`,
  );
  let expiredLots = 0;
  let totalMp = 0;
  for (const lot of expired.rows) {
    const lotId = lot.id as string;
    const lotUser = lot.user_id as string;
    const amt = Number(lot.remaining_mp);
    // ② 幂等闸：先探一笔 expire 是否已写过（uq_expire_lot(ref_id=lot_id)）。
    const dup = await c.query("SELECT 1 FROM credit_ledger WHERE entry_type='expire' AND ref_type='lot' AND ref_id=$1", [
      lotId,
    ]);
    if ((dup.rowCount ?? 0) > 0) continue; // 重跑：本批此前已清，跳过。
    // ③ 批次清零。
    await c.query("UPDATE credit_lots SET remaining_mp=0 WHERE id=$1", [lotId]);
    // ④ 物化余额减（不出负）+ RETURNING 取本笔扣减后结余。
    const acc = await c.query(
      "UPDATE credit_accounts SET balance_mp=GREATEST(balance_mp-$1,0), updated_at=now() WHERE user_id=$2 RETURNING balance_mp",
      [amt, lotUser],
    );
    const balanceAfter = Number(acc.rows[0].balance_mp);
    // ⑤ expire 流水（balance_after 用④逐笔真值；uq_expire_lot 兜底）。
    await c.query(
      `INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
       VALUES ($1,'expire',$2,$3,'lot',$4)
       ON CONFLICT DO NOTHING`,
      [lotUser, amt, balanceAfter, lotId],
    );
    // ⑥ 事实事件。
    await c.query("INSERT INTO events(type,user_id,payload) VALUES('credit_expired',$1,$2)", [
      lotUser,
      { lotId, amountMp: amt },
    ]);
    expiredLots += 1;
    totalMp += amt;
  }
  return { expiredLots, totalMp };
}

/** 每日过期 cron。传入既有 client c 则在其事务内跑；否则自起单事务。幂等（uq_expire_lot）。 */
export async function expireCredits(c?: TxClient): Promise<ExpireResult> {
  if (c) return run(c);
  return tx((cc) => run(cc));
}
