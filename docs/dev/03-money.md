# 4 · 钱 / 积分链路（核心）

> **本章是全文档最详、最不能错的一章。** 钱/码/并发在并发与重试下极易出错，下面给**可直接照写的事务步骤 + 幂等键 + 抢占式状态机**。所有金额毫积分（mp）整数。
> 规则真相源：规格 [§6](../redesign-requirements.md)（计费）/ [§7](../redesign-requirements.md)（兑换）/ [§22](../redesign-requirements.md)（工程一致性）。本章把它们落成 SQL。
> **所有多语句事务走 Neon Pool/WS + `FOR UPDATE`**（[00 §1.3](00-overview.md)）。

## 4.1 余额模型（批次为权威，物化余额为缓存）

```
权威余额 = SUM(credit_lots.remaining_mp) WHERE user_id=? AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())
缓存余额 = credit_accounts.balance_mp      （每次钱事务内同步更新；每日 cron 对账）
```

- **读余额（展示）**：读 `credit_accounts.balance_mp`（快、HTTP 即可）。
- **判断能否扣费/对账**：以 `credit_lots` 之和为准。
- **每日 cron 对账**：比对两者，不一致 → 告警 + 以批次为准修正（[10-ops-test.md §11.3](10-ops-test.md)）。

## 4.2 五条幂等键（部分唯一索引，已在 [02 §3.3](02-database.md) 建好）

| 幂等键 | 防的事 | 触发场景 |
|---|---|---|
| `uq_debit(ref_id=generation_id)` | 同一生成重复扣费 | 平台重试/cron 重扫重入扣费步 |
| `uq_refund(ref_id=generation_id)` | 同一生成重复退款 | 失败退款被调多次 |
| `uq_grant_signup(ref_id=user_id)` | 注册重复发 0.14 | 注册重试 |
| `uq_credit_code(ref_id=code_id)` | 同一码重复入账 | 兑换并发双击 |
| `uq_expire_lot(ref_id=lot_id)` | 同一批次重复清零 | 过期 cron 重跑 |

> 幂等的统一手法：**先抢唯一约束、命中冲突即认为"已做过"、安全跳过**。配合 `ON CONFLICT DO NOTHING` 或捕获唯一冲突错误。

## 4.3 扣费事务（成功才扣 · 可执行步骤）

**判定“成功” = 图落对象存储成功 + 写库成功。** 顺序：**先传 Supabase Storage（事务外，结果存临时变量）→ 再开单事务**。

```ts
// —— 事务外：已从中转拿到图，先落对象存储 ——
// putToR2 签名以 [06-storage.md §7.3](06-storage.md) 为准：(userId, generationId, relayImage)；relayImage = 中转返回的 {b64_json?,url?}，函数内部自取字节
const { storageKey, publicUrl, contentType, width, height, sizeBytes } = await putToR2(userId, generationId, relayImage);

// —— 单事务（Pool/WS）——
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // ⓪ 双守卫（必须是事务第一步 = 串行化点；缺它会同时踩 money-1 重复扣 与 pipe-1 失败仍扣）
  //   a) 锁该 generation 行 + 确认仍 running：挡「超时 cron 已把合法 >5min 的 running 置 failed」(§4.6)。
  //      非 running（已 failed/succeeded/不存在）→ 不扣不插，整笔回滚；存储孤儿交清理 cron（成功才扣的硬边界）。
  const g = await client.query(
    `SELECT status FROM generations WHERE id=$1 FOR UPDATE`, [generationId]);
  if (g.rowCount === 0 || g.rows[0].status !== 'running') {
    await client.query('ROLLBACK');
    return; // 非 running 一律不扣费
  }
  //   b) 探 debit 是否已存在（平台重试/事务重投重入）：已扣过 → 只补置终态、绝不再扣 lots/余额。
  const dup = await client.query(
    `SELECT 1 FROM credit_ledger WHERE entry_type='debit' AND ref_id=$1`, [generationId]);
  if (dup.rowCount > 0) {
    await client.query(
      `UPDATE generations SET status='succeeded', updated_at=now() WHERE id=$1 AND status='running'`, [generationId]);
    await client.query('COMMIT'); // 幂等空操作收尾
    return;
  }

  // ① 锁该用户可用批次，按 FIFO（最早过期先扣，永久批次最后）
  const lots = await client.query(`
    SELECT id, remaining_mp FROM credit_lots
    WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())
    ORDER BY expires_at ASC NULLS LAST, created_at ASC
    FOR UPDATE
  `, [userId]);

  // ② 跨批次 FIFO 扣减，各批 remaining 不出负；实扣量 charged 可能 < PRICE_MP（见兜底）
  let need = PRICE_MP;
  for (const lot of lots.rows) {
    if (need <= 0) break;
    const take = Math.min(lot.remaining_mp, need);
    await client.query(`UPDATE credit_lots SET remaining_mp = remaining_mp - $1 WHERE id=$2`, [take, lot.id]);
    need -= take;
  }
  const charged = PRICE_MP - need; // 实际扣到的毫积分（正常 = 70）
  // 极端并发兜底（落成代码、非纯注释）：need>0 = 余额在「入队余额闸(§4.9)」与此刻之间被另一并发扣空。
  // 规格 §6.2 接受「扣到 0、零头站长承担」；账本/余额/credits_charged 一律用实扣量 charged（不硬编码 PRICE_MP），
  // 保证「账本 debit = lots 实扣 = 物化余额减量」三者自洽，并记一条告警 event 便于对账。
  if (need > 0) {
    await client.query(`INSERT INTO events(type,user_id,payload) VALUES('credit_shortfall',$1,$2)`,
      [userId, { generationId, wantMp: PRICE_MP, chargedMp: charged }]);
  }

  // ③ 落 images（generation_id UNIQUE 防重复插）
  await client.query(`
    INSERT INTO images(generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (generation_id) DO NOTHING
  `, [generationId,userId,storageKey,publicUrl,contentType,width,height,sizeBytes, retentionExpiry(user, cfg)]);
  // retentionExpiry 签名以 [06-storage.md §7.4](06-storage.md) 为准：(user, cfg{freeDays,paidDays})；cfg 取自 app_config

  // ④ 物化余额：先减、用 RETURNING 取「本笔后」真实结余（不从可能已漂移的缓存推算，口径对齐 [§4.8](#48-积分过期fifo--幂等--cron) / [10 §11.2](10-ops-test.md)）
  const acct = await client.query(
    `UPDATE credit_accounts SET balance_mp = balance_mp - $1, updated_at=now() WHERE user_id=$2 RETURNING balance_mp`,
    [charged, userId]);
  const balanceAfter = acct.rows[0].balance_mp;

  // ⑤ 账本 debit（amount/balance_after 都用实扣量与④真值；uq_debit 是兜底硬防线——⓪b 已先探，正常到不了冲突）
  await client.query(`
    INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
    VALUES ($1,'debit',$2,$3,'generation',$4)
    ON CONFLICT DO NOTHING
  `, [userId, charged, balanceAfter, generationId]);

  // ⑥ 终态 + 事实事件（duration_ms 用 EPOCH 取整段总毫秒——切勿用 EXTRACT(MILLISECONDS…) 见 [§4.6](#46-5-分钟超时与失败退款)）
  await client.query(`
    UPDATE generations SET status='succeeded', credits_charged_mp=$1,
      completed_at=now(), duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int, updated_at=now()
    WHERE id=$2 AND status='running'
  `, [charged, generationId]);
  await client.query(`INSERT INTO events(type,user_id,payload) VALUES('image_succeeded',$1,$2)`,
    [userId, { generationId, creditsChargedMp: charged }]);

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');   // 孤儿存储对象由清理 cron 扫掉（10 章）
  throw e;
} finally {
  client.release();
}
```

### 4.3.1 为什么步骤 ⓪ 的双守卫不可省（重试安全 + 成功才扣）

⓪ 不是"理想实现"、而是**正文第一步的硬约束**，挡两类竞态：

- **⓪b 探 `uq_debit`（防重复扣）**：平台对 Background Function 自动重试（约 1/2min）、或扣费事务被重投，会让同一 `generation_id` 重入扣费。若按"先扣 lots 再 `ON CONFLICT` 判幂等"的旧顺序，第二次仍会先把 lots 再扣一遍、到账本才因 `uq_debit` 冲突跳过 → **lots 被扣两次、物化余额只减一次、账本只一条**，三者漂移。把探测放到扣 lots 之前、与扣减同处一个 `FOR UPDATE` 事务，串行化保证两个并发重入只有一个走完 ①~⑥、另一个探到 debit 已存在即空操作返回。`uq_debit` 仍是兜底硬防线（即便探测漏了，⑤的 `ON CONFLICT` 也吞掉重复扣）。
- **⓪a 锁 generation 行 + 断言 `running`（防"失败仍扣"）**：中转合法耗时 >5min 且 <15min 时，每分钟的超时 cron（[§4.6](#46-5-分钟超时与失败退款)）可能先把该行 `running→failed/provider_timeout` 并释放并发；随后后台函数才拿到结果进扣费事务。若不先校验状态，就会**扣了钱、但 generations 停在 failed、前端显示"失败·未扣"**——违背"成功才扣"。⓪a 用 `SELECT … FOR UPDATE` 锁住该行：若超时 cron 已先提交（状态变 failed）→ 本事务读到非 running → 整笔回滚不扣；若本事务先持锁 → cron 的 `UPDATE` 阻塞到提交后、届时状态已 succeeded、其 `WHERE status IN(...)` 不再命中。两种顺序都安全。

> 测试必须覆盖：①同一 generation 重投/重试不重复扣（[10 §11.10](10-ops-test.md)）；②"running 行被超时 cron 置 failed 后，扣费事务不得扣费、不得插 images"。

## 4.4 注册原子发放（建号即发 0.14，单事务）

```ts
// Better Auth 注册回调成功后（或 after-hook 内），单事务：
await tx(async (c) => {
  await c.query(`INSERT INTO users(id,email) VALUES($1,$2) ON CONFLICT (id) DO NOTHING`, [userId, email]); // 与 Better Auth user 对齐策略见 05 章
  await c.query(`INSERT INTO credit_accounts(user_id,balance_mp) VALUES($1,$2)
                 ON CONFLICT (user_id) DO NOTHING`, [userId, GRANT_MP]); // GRANT_MP=140
  // 建 signup 批次（30 天到期；有效期取 app_config）
  await c.query(`INSERT INTO credit_lots(user_id,source,granted_mp,remaining_mp,expires_at)
                 VALUES($1,'signup',$2,$2, now() + ($3 || ' days')::interval)`, [userId, GRANT_MP, grantValidDays]);
  // grant 流水（uq_grant_signup 幂等：重试不重发）
  await c.query(`INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
                 VALUES($1,'grant',$2,$2,'signup',$1) ON CONFLICT DO NOTHING`, [userId, GRANT_MP]);
  await c.query(`INSERT INTO events(type,user_id,payload) VALUES('user_registered',$1,$2),('credit_granted',$1,$3)`,
                [userId, { email }, { amountMp: GRANT_MP, source:'signup' }]);
});
```

杜绝"建号成功但没发积分"窗口；`uq_grant_signup(ref_id=user_id)` 保证重试不重发。**注意密码限长**防 bcrypt 72 字节截断（[05-auth.md §6.4](05-auth.md)）。

## 4.5 抢占式状态机（铁律③ · 防平台重试重复下单/扣费）

中转**同步阻塞、无 webhook**；平台对 Background Function 有自动重试（约 1/2 min），cron 还会重扫——若不防，同一 `generation` 会被多次送中转（重复下单、烧钱）+ 多次扣费。

**状态流转**（[02 §3.2](02-database.md) `generations.status`）：

```
queued ──抢占──> claimed ──调中转前──> running ──落图+扣费──> succeeded
   │                                        │
   └────────────────────────────────────────┴── 失败/超时 ──> failed
```

**抢占（Background Function 入口第一件事）**：

```sql
UPDATE generations
SET status='claimed', job_id=$workerTag, updated_at=now()
WHERE id=$generationId AND status='queued'
RETURNING id;
-- affected=1 → 抢到，继续生图
-- affected=0 → 别人抢过了（或已终态）→ 立即退出，不调中转、不扣费
```

这条单语句 `UPDATE…WHERE status='queued' RETURNING` 是铁律③的核心：**只有第一个把 `queued→claimed` 的实例能继续**，平台重试的第二个实例 `affected=0` 直接退，挡掉重复下单。调中转前再按 `generation_id` 查重或带**请求级幂等键**（中转是否支持待确认 [§19](../redesign-requirements.md)）。

**置 running**（抢到后、调中转前）：`UPDATE generations SET status='running', started_at=now() WHERE id=$ AND status='claimed'`。

## 4.6 统一 5 分钟 deadline 与失败退款

- generation 创建成功时写 `deadline_at=created_at+5min`，system/custom 使用同一起点；排队时间也计入，不从 `started_at` 重新计时。
- **权威超时收口**：状态读取与 cron 共用单一 helper，按 `status IN('queued','claimed','running') AND deadline_at<=now()` 做带状态谓词的原子更新。只有拿到 affected row 的调用方写 `failed/provider_timeout`、脱敏事件并删除临时凭据；cron 是无人轮询时兜底，不是唯一入口（[10-ops-test.md §11.11](10-ops-test.md)）。
- Background 上游请求最迟在 `deadline_at-30s` 中止，把 30 秒留给响应解析、对象存储与终态事务；不得在 claim/running 后重置完整 5 分钟。
- **失败不扣费**：失败/超时路径**从不进本站扣费事务**，`credits_charged_mp=0`，前端固定显示“请求超时，本站未扣积分，请重试”；custom 的第三方计费以服务商规则为准。
- **退款仅用于"已扣后又判失败"的极端补偿**（正常流程用不到，因成功才扣）：若将来出现该情形，走 `refund` 流水（`uq_refund` 幂等）+ 回补对应批次 `remaining_mp` + 物化余额，写 `events`。本期主流程不触发。
- 释放并发 = 状态进终态，自动反映到 `COUNT`，无双减/漏减。

> 迁移前 system-only 代码使用 `COALESCE(started_at,updated_at)<now()-5min` 的 cron SQL。该谓词仅作历史基线，实施本需求后统一改读 `deadline_at`，同时覆盖 `queued`。

## 4.7 兑换核销事务（单语句原子 + 同事务入账）

```ts
await tx(async (c) => {
  // 1) 原子核销：单语句即防一码多花/并发双击
  const r = await c.query(`
    UPDATE redeem_codes SET status='redeemed', redeemed_by=$2, redeemed_at=now()
    WHERE code=$1 AND status='active'
    RETURNING id, credits_value_mp, cash_value, package_id, valid_days
  `, [code, userId]);
  if (r.rowCount === 0) {
    // 区分错误码：再查当前状态决定 404 不存在 / 410 已用 / 410 已作废
    throw redeemError(await lookupCodeStatus(c, code));
  }
  const { id: codeId, credits_value_mp, cash_value, valid_days } = r.rows[0];

  // 2) 建新批次（按 valid_days 设 expires_at；NULL=永久）
  await c.query(`INSERT INTO credit_lots(user_id,source,code_id,granted_mp,remaining_mp,expires_at)
                 VALUES($1,'code',$2,$3,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now()+($4||' days')::interval END)`,
                [userId, codeId, credits_value_mp, valid_days]);

  // 3) credit 流水（uq_credit_code 幂等）
  await c.query(`INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
                 VALUES($1,'credit',$2,(SELECT balance_mp+$2 FROM credit_accounts WHERE user_id=$1),'code',$3)
                 ON CONFLICT DO NOTHING`, [userId, credits_value_mp, codeId]);

  // 4) 物化余额
  await c.query(`UPDATE credit_accounts SET balance_mp=balance_mp+$1, updated_at=now() WHERE user_id=$2`, [credits_value_mp, userId]);

  // 5) 首次兑换 → 升级付费 + 旧图保留期顺延 60 天
  const upd = await c.query(`UPDATE users SET has_paid=true, updated_at=now() WHERE id=$1 AND has_paid=false RETURNING id`, [userId]);
  if (upd.rowCount === 1) {
    await c.query(`UPDATE images SET expires_at = GREATEST(COALESCE(expires_at, now()), now()+interval '60 days') WHERE user_id=$1`, [userId]);
  }

  // 6) 事实事件（收入按面值 cash_value 记账）
  await c.query(`INSERT INTO events(type,user_id,payload) VALUES('code_redeemed',$1,$2)`,
                [userId, { codeId, creditsValueMp: credits_value_mp, cashValue: cash_value }]);
});
```

**防刷**：兑换接口按 IP/账号限流（如 5 次/10 分钟 → 429），防暴力枚举刷码（[07-api.md §8.4](07-api.md)）。

> **首次升级顺延的边界（已知极小窗口）**：step 5 的 `UPDATE images … 60 days` 只作用于**兑换那一刻已存在**的图。若用户在兑换前后秒级窗口内有一张并发生成的图，其扣费事务（[§4.3](#43-扣费事务成功才扣--可执行步骤) ③）按生图事务起始快照的 `has_paid=false` 写了 7 天保留期，可能漏被顺延。兜底：图片清理 cron（[10-ops-test.md §11.7](10-ops-test.md)）删图前对 `has_paid=true` 的用户再核一次 `expires_at`、不足 60 天则顺延，避免这张图早于 60 天被清。

## 4.8 积分过期（FIFO + 幂等 · cron）

```sql
-- 每日 cron：把过期未用批次清零 + 写 expire 流水（uq_expire_lot 幂等；永久批次 expires_at IS NULL 跳过）
WITH expired AS (
  SELECT id, user_id, remaining_mp FROM credit_lots
  WHERE expires_at IS NOT NULL AND expires_at < now() AND remaining_mp > 0
  FOR UPDATE
)
-- 对每个 expired：
--   INSERT credit_ledger(expire, amount=remaining, ref_type='lot', ref_id=lot_id) ON CONFLICT DO NOTHING
--   UPDATE credit_lots SET remaining_mp=0 WHERE id=lot_id
--   UPDATE credit_accounts SET balance_mp = balance_mp - remaining（或事后整体对账重算）
--   INSERT events(credit_expired, ...)
```

消费侧 `ORDER BY expires_at ASC NULLS LAST` 已保证最早过期先扣；过期 cron 只清"到期仍有余"的批次。详见 [10-ops-test.md §11.2](10-ops-test.md)。

## 4.9 入队前的余额 + 并发双重闸（在 `generate` 同步函数内）

```ts
await tx(async (c) => {
  // system 并发闸：custom 不占 max_concurrency
  const inflight = await c.query(
    `SELECT COUNT(*)::int n FROM generations
     WHERE user_id=$1 AND credential_mode='system' AND status IN('queued','claimed','running')`, [userId]);
  if (inflight.rows[0].n >= user.max_concurrency) throw httpError(409, '超出并发数量');

  // 余额闸：可用批次之和 ≥ PRICE_MP（不足直接报错、不入队、不扣费）
  const bal = await c.query(
    `SELECT COALESCE(SUM(remaining_mp),0)::bigint s FROM credit_lots
     WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`, [userId]);
  if (bal.rows[0].s < PRICE_MP) throw httpError(402, '积分不足，去充值');

  // 预算熔断闸（铁律①）= 软第一道闸：当日中转预算未超才放行入队（省 compute）
  if (await isDailyBudgetExhausted(c)) throw httpError(429, '今日额度已满，请稍后');

  // 通过 → 建会话（如新）+ INSERT generations(status=queued) RETURNING id
  // 返回 202 {generationId}
});
```

> 余额校验**只判不扣**（成功才扣）。把"没钱的"拦在队列外是省 compute 的第一道闸；真正扣费在 4.3 的成功事务里。
>
> ⚠️ **预算闸在这里只是"软第一道闸"，不是硬上限**：本闸**读**当日计数，而计数的**写**（incCall）在后台函数调中转前才发生（[04 §5.6](04-generation-pipeline.md)）。N 个请求并发入队时都读到偏旧的 calls、全部放行，随后才陆续 incCall → 会**冲过**阈值。**真正"防破产"的硬上限**必须做成**与递增同一条原子语句**：后台函数调中转前 `UPDATE app_config SET …calls+1 WHERE key=今日 AND (value_json->>'calls')::bigint < 阈值 RETURNING`，`affected=0` 即越界、不调中转（[04 §5.6](04-generation-pipeline.md) 为权威实现）。此处入队闸保留为省 compute 的快速预拦即可。

## 4.10 钱链路红线清单（落地必守）

- [ ] 金额全程 mp 整数，展示才转小数。
- [ ] 多语句钱事务走 Pool/WS + `FOR UPDATE`，**不走 HTTP 单语句模式**。
- [ ] 扣费事务**第一步 = 双守卫**：锁 generation 行断言 `running`（防超时 cron 翻 failed 后仍扣）+ 探 debit（防重入重复扣），再扣 lots；`uq_debit` 兜底（4.3.1）。
- [ ] 扣费 amount/balance_after 用**实扣量** charged 与物化余额 `RETURNING` 真值（非硬编码 70 / 非缓存推算）。
- [ ] **预算硬上限**做成"与递增同一原子语句"（[04 §5.6](04-generation-pipeline.md)），入队闸只算软预拦。
- [ ] 抢占式 `UPDATE…WHERE status='queued' RETURNING` 是后台函数第一步。
- [ ] 兑换 `UPDATE…WHERE status='active' RETURNING`，`affected=1` 才入账。
- [ ] 注册原子发放 `uq_grant_signup`，密码限长防 bcrypt 截断。
- [ ] 过期/退款各自幂等键；永久批次（`expires_at IS NULL`）跳过过期。
- [ ] 物化余额每事务同步 + 每日 cron 对账，以批次为准。
- [ ] 钱链路对**真 Neon 分支库**跑事务测试（含并发双击/重试重入用例，[10](10-ops-test.md)）。

## 4.11 custom 零扣费分支（2026-07-11）

本章 §4.1–§4.10 的余额、预算、并发和扣费规则属于 **system 模式**。custom 入队仍做严格鉴权、封禁、参数、会话归属和参考图归属校验，但显式跳过：

- `credit_lots` 可用余额查询；
- `users.max_concurrency` in-flight 判断；
- system `relay_budget:*` 预检查与原子递增；
- 任何 `credit_accounts`、`credit_lots`、`credit_ledger` 写入。

custom 落图后的幂等成功事务：

```sql
BEGIN;
SELECT id, status, credential_mode
FROM generations
WHERE id=$generation_id AND user_id=$user_id
FOR UPDATE;

-- 必须断言 status='running' AND credential_mode='custom'；
-- 已 succeeded/failed 则幂等退出，不得覆盖终态。
INSERT INTO images (..., generation_id, user_id, ...)
VALUES (...)
ON CONFLICT (generation_id) DO NOTHING;

UPDATE generations
SET status='succeeded', credits_charged_mp=0,
    completed_at=now(), duration_ms=..., updated_at=now()
WHERE id=$generation_id AND status='running' AND credential_mode='custom';

INSERT INTO events(type,user_id,payload)
VALUES ('image_succeeded',$user_id,
        jsonb_build_object('generationId',$generation_id,
                           'credentialMode','custom',
                           'creditsChargedMp',0,
                           'durationMs',...));

DELETE FROM generation_credentials WHERE generation_id=$generation_id;
COMMIT;
```

- 事件必须可幂等去重；若现有 `events` 无唯一键，先依据 generation 终态更新的 affected row 决定是否插事件。
- custom 失败/超时事务只写脱敏失败终态/事件并删凭据；余额、lots、ledger 均保持字节级不变。
- system 继续调用现有 `chargeOnSuccess`，不得为复用 custom 而削弱双守卫、FIFO 或 `uq_debit`。
- 真库测试必须覆盖：零余额 custom 成功；system 预算/并发已满时 custom 仍入队；custom 成功/重入/失败/超时均零 debit；system 回归仍只扣一次；两种 mode 伪造/串路被拒。
