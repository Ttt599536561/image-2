// ★server-only：扣费事务（命门 · 成功才扣，真相源 03 §4.3 / §4.3.1）。落 R2 在「事务外」先做、结果当入参传入；
//   本函数只跑「单 Pool/WS 事务 + FOR UPDATE」。
//
// 顺序（一字不差照 03 §4.3）：
//   ⓪a 锁 generation 行 + 断言 running（挡超时 cron 翻 failed 后仍扣 = pipe-1）
//   ⓪b 探 uq_debit 已存在（挡平台重试/重投重入重复扣 lots = money-1；命中则只补置终态、绝不再扣）
//   ① FIFO 锁可用批次（ORDER BY expires_at ASC NULLS LAST, created_at ASC）
//   ② 跨批 FIFO 扣减不出负，实扣量 charged（极端并发可能 < PRICE_MP，记 credit_shortfall）
//   ③ INSERT images ON CONFLICT(generation_id) DO NOTHING
//   ④ 物化余额 -charged，RETURNING 取本笔后真值（不从缓存推算）
//   ⑤ ledger debit（amount/balance_after 用实扣量与④真值；uq_debit ON CONFLICT 兜底）
//   ⑥ generations→succeeded + duration_ms=(EXTRACT(EPOCH…)*1000)::int + image_succeeded 事件
//
// 🔴 红线：成功才扣 + generation_id 幂等 + 防双花；charged===0（余额被并发扣空）时跳过 ④⑤（amount_mp CHECK>0）、
//   仍落 images 并置 succeeded（极端零头站长承担）；duration_ms 绝不用 EXTRACT(MILLISECONDS…)。
import { readConfigInt } from "../config.server";
import { retentionExpiry } from "../r2.server";
import { type TxClient, tx } from "../tx.server";

export interface DebitInput {
  generationId: string;
  userId: string;
  // putToR2 结果（事务外取得）
  storageKey: string;
  publicUrl: string;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
}

export interface DebitResult {
  outcome: "charged" | "idempotent" | "not_running";
  charged: number; // 实扣毫积分（idempotent/not_running 为 0）
  balanceAfter: number | null;
}

async function run(c: TxClient, input: DebitInput): Promise<DebitResult> {
  const priceMp = await readConfigInt(c, "price_per_image_mp", 70);
  const freeDays = await readConfigInt(c, "retention_free_days", 7);
  const paidDays = await readConfigInt(c, "retention_paid_days", 60);

  // ⓪a 锁该 generation 行 + 断言 running。非 running（已 failed/succeeded/不存在）→ 不扣不插、整笔回滚。
  const g = await c.query("SELECT status FROM generations WHERE id=$1 FOR UPDATE", [input.generationId]);
  if (g.rowCount === 0 || g.rows[0].status !== "running") {
    return { outcome: "not_running", charged: 0, balanceAfter: null };
  }

  // ⓪b 探 uq_debit（重入）。已扣过 → 只补置终态、绝不再扣 lots/余额。
  const dup = await c.query("SELECT 1 FROM credit_ledger WHERE entry_type='debit' AND ref_id=$1", [input.generationId]);
  if ((dup.rowCount ?? 0) > 0) {
    await c.query("UPDATE generations SET status='succeeded', updated_at=now() WHERE id=$1 AND status='running'", [
      input.generationId,
    ]);
    return { outcome: "idempotent", charged: 0, balanceAfter: null };
  }

  // ① FIFO 锁可用批次（最早过期先扣，永久批次最后）。
  const lots = await c.query(
    `SELECT id, remaining_mp FROM credit_lots
     WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())
     ORDER BY expires_at ASC NULLS LAST, created_at ASC
     FOR UPDATE`,
    [input.userId],
  );

  // ② 跨批 FIFO 扣减，各批 remaining 不出负。
  let need = priceMp;
  for (const lot of lots.rows) {
    if (need <= 0) break;
    const take = Math.min(Number(lot.remaining_mp), need);
    await c.query("UPDATE credit_lots SET remaining_mp = remaining_mp - $1 WHERE id=$2", [take, lot.id]);
    need -= take;
  }
  const charged = priceMp - need; // 实扣量（正常 = priceMp）
  if (need > 0) {
    // 极端并发兜底：余额在入队闸与此刻之间被另一并发扣空。账本/余额/credits 一律用实扣量 charged，记一条告警 event。
    await c.query("INSERT INTO events(type,user_id,payload) VALUES('credit_shortfall',$1,$2)", [
      input.userId,
      { generationId: input.generationId, wantMp: priceMp, chargedMp: charged },
    ]);
  }

  // 保留期取本人 has_paid（兑换升级写入）。
  const u = await c.query("SELECT has_paid FROM users WHERE id=$1", [input.userId]);
  const hasPaid = Boolean(u.rows[0]?.has_paid);
  const expiresAt = retentionExpiry({ has_paid: hasPaid }, { freeDays, paidDays });

  // ③ 落 images（generation_id UNIQUE 防重复插）。
  await c.query(
    `INSERT INTO images(generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (generation_id) DO NOTHING`,
    [
      input.generationId,
      input.userId,
      input.storageKey,
      input.publicUrl,
      input.contentType ?? null,
      input.width ?? null,
      input.height ?? null,
      input.sizeBytes ?? null,
      expiresAt,
    ],
  );

  let balanceAfter: number | null = null;
  if (charged > 0) {
    // ④ 物化余额 -charged，RETURNING 取本笔后真值。
    const acct = await c.query(
      "UPDATE credit_accounts SET balance_mp = balance_mp - $1, updated_at=now() WHERE user_id=$2 RETURNING balance_mp",
      [charged, input.userId],
    );
    balanceAfter = Number(acct.rows[0].balance_mp);

    // ⑤ ledger debit（amount/balance_after 用实扣量与④真值；uq_debit 兜底）。
    //    user_id(uuid)=$1 与 ref_id(text)=$4 用「不同参数」传同一 generationId，避免单参跨两型触发 42P08。
    await c.query(
      `INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
       VALUES ($1,'debit',$2,$3,'generation',$4)
       ON CONFLICT DO NOTHING`,
      [input.userId, charged, balanceAfter, input.generationId],
    );
  }
  // charged===0：lots/余额不动、无 ledger（amount_mp CHECK>0）；仍落 images 并置 succeeded（已记 credit_shortfall）。

  // ⑥ 终态 + 事实事件。duration_ms 用 EPOCH 整段总毫秒（绝不 EXTRACT(MILLISECONDS…)）。
  await c.query(
    `UPDATE generations SET status='succeeded', credits_charged_mp=$1, completed_at=now(),
       duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
     WHERE id=$2 AND status='running'`,
    [charged, input.generationId],
  );
  await c.query("INSERT INTO events(type,user_id,payload) VALUES('image_succeeded',$1,$2)", [
    input.userId,
    { generationId: input.generationId, creditsChargedMp: charged },
  ]);

  return { outcome: "charged", charged, balanceAfter };
}

/**
 * 扣费事务（成功才扣 + 幂等 + 防双花）。putToR2 必须在「调用本函数之前·事务外」完成、结果作入参传入。
 * 传入既有 client c 则在其事务内跑（少见）；否则自起单事务。
 */
export async function chargeOnSuccess(input: DebitInput, c?: TxClient): Promise<DebitResult> {
  if (c) return run(c, input);
  return tx((cc) => run(cc, input));
}
