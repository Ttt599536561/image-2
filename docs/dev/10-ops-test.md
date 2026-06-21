# 11 · cron / 可观测 / 测试

> 把"DB-as-queue 的兜底、钱的对账、成本的实测、上线的质量门"四件事落成可执行调度 + 测试。
> 规则真相源：规格 [§22](../redesign-requirements.md)（工程一致性/对账/熔断）/ [§23](../redesign-requirements.md)（可观测告警）/ [§9 看板](../redesign-requirements.md)。本章把 [03-money.md](03-money.md) 的事务设计落成定时任务，并给 CI 门禁。
> env（`SENTRY_DSN` / `ADMIN_ALERT_WEBHOOK` / `DAILY_RELAY_BUDGET_*`）见 [00-overview.md §1.4](00-overview.md)；Scheduled Function 形态见 [00-overview.md §1.2](00-overview.md)。

## 11.1 Scheduled 总览

阶段一 DB-as-queue 靠**抢占式状态机 + cron 兜底重扫**撑住可靠性；钱靠**事务内同步物化余额 + cron 每日对账**保证不漂。下表是全部定时任务（每条都必须幂等——可被平台重复触发、被手动重跑而不出错）。

| 任务 | cron (UTC) | 作用 | 幂等点 | 落地 |
|---|---|---|---|---|
| 超时重扫 | `*/1 * * * *` 每分钟 | `claimed/running` 且 `COALESCE(started_at,updated_at)<now()-5min` → `failed/provider_timeout`（兜底僵尸 claimed） | `UPDATE…WHERE status IN(claimed,running)`（已终态行不再命中） | [§11.6](#116-超时重扫-cron) |
| 旧预算键清理 | `0 16 * * *`（= 北京 00:00） | 清理/归档旧日期的中转预算键 + 近阈告警（当日键靠 date-in-key 自动归零，无需清零） | 删旧键天然幂等；不 upsert 固定行 | [§11.8](#118-旧预算键清理-cron) |
| 积分过期 | `10 16 * * *`（北京 00:10） | 过期批次清零 + `expire` 流水 + 同步余额 | `uq_expire_lot`（每 lot 只清一次）；永久批次 `expires_at IS NULL` 跳过 | [§11.2](#112-积分过期-cron) |
| 余额对账 | `30 16 * * *`（北京 00:30） | 物化余额 vs `SUM(lots.remaining 未过期)`，不平告警+以批次修正 | 重算覆盖（重跑收敛到同值） | [§11.3](#113-余额对账-cron) |
| 图片清理 | `0 17 * * *`（北京 01:00） | 删过期 R2 对象 + DB + `events(image_cleaned)` + 孤儿清理 | 删除天然幂等；已删行不再命中 | [§11.7](#117-图片清理-cron) |

> 时区：cron 是 UTC，"每日 0 点"按运营所在北京时区折算（UTC+8 → UTC 的 16:00）。过期/对账/清理**错峰**排（00:10/00:30/01:00），避免与旧预算键清理同刻抢连接、且对账在过期之后跑（先清过期再对账才准）。

**Netlify Scheduled Function 配置形态**（二选一，见 [00-overview.md §1.2](00-overview.md)）：

```ts
// 形态 A（推荐）：函数内导出 config.schedule —— 调度与代码同文件，便审阅
// netlify/functions/cron-expire-credits.ts
import type { Config } from '@netlify/functions';
export default async (req: Request) => {
  await runExpireCredits();           // 见 §11.2
  return new Response('ok');
};
export const config: Config = { schedule: '10 16 * * *' };
```

```toml
# 形态 B：netlify.toml 集中声明（适合一眼看全部 cron）
[functions."cron-timeout-rescan"]
  schedule = "*/1 * * * *"
[functions."cron-budget-cleanup"]
  schedule = "0 16 * * *"
```

约定：cron 函数统一命名 `cron-*.ts`，**非 `-background` 后缀**（Scheduled 由 schedule 触发，不是 Background）。每个 cron handler 包一层 `try/catch`：异常上报 Sentry + 推 `ADMIN_ALERT_WEBHOOK`（[§11.9](#119-可观测与告警)），**绝不静默吞**。钱相关 cron（过期/对账）走 Pool/WS 事务（`DATABASE_URL_UNPOOLED`）；只读扫描走 HTTP（`DATABASE_URL` pooled）。

## 11.2 积分过期 cron

落地 [03-money.md §4.8](03-money.md)：把"到期仍有余"的批次清零、写 `expire` 流水（`uq_expire_lot` 幂等）、同步物化余额。**永久批次（`expires_at IS NULL`）永不过期，必须跳过。**

**单事务步骤**（Pool/WS + `FOR UPDATE`，逐批处理）：

```ts
async function runExpireCredits() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // ① 锁住所有"到期且仍有余"的批次（永久批次 expires_at IS NULL 不命中）
    const expired = await client.query(`
      SELECT id, user_id, remaining_mp FROM credit_lots
      WHERE expires_at IS NOT NULL AND expires_at < now() AND remaining_mp > 0
      FOR UPDATE
    `);
    for (const lot of expired.rows) {
      // ② 幂等闸：先探一笔 expire 是否已写过（uq_expire_lot(ref_id=lot_id)）。
      //    用单独探测而非把 balance_after 塞进 INSERT 子查询——balance_after 必须取"本笔扣减后"的真值，
      //    多笔 expire 要逐笔递减、与最终物化余额一致（D22 / 03 账本逐笔结余口径）。
      const dup = await client.query(
        `SELECT 1 FROM credit_ledger WHERE entry_type='expire' AND ref_type='lot' AND ref_id=$1`,
        [lot.id]);
      if (dup.rowCount > 0) continue;              // 重跑：本批此前已清，跳过 ③④⑤
      // ③ 批次清零
      await client.query(`UPDATE credit_lots SET remaining_mp=0 WHERE id=$1`, [lot.id]);
      // ④ 物化余额减（不出负）+ RETURNING 取本笔扣减后的结余，作为本条流水的 balance_after
      const acc = await client.query(`UPDATE credit_accounts
        SET balance_mp=GREATEST(balance_mp-$1,0), updated_at=now() WHERE user_id=$2
        RETURNING balance_mp`,
        [lot.remaining_mp, lot.user_id]);
      const balanceAfter = acc.rows[0].balance_mp;
      // ⑤ expire 流水：balance_after_mp 用 ④ 的逐笔结余真值；uq_expire_lot 兜底防重写
      await client.query(`
        INSERT INTO credit_ledger(user_id,entry_type,amount_mp,balance_after_mp,ref_type,ref_id)
        VALUES ($1,'expire',$2,$3,'lot',$4)
        ON CONFLICT DO NOTHING
      `, [lot.user_id, lot.remaining_mp, balanceAfter, lot.id]);
      // ⑥ 事实事件
      await client.query(`INSERT INTO events(type,user_id,payload) VALUES('credit_expired',$1,$2)`,
        [lot.user_id, { lotId: lot.id, amountMp: lot.remaining_mp }]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
```

> 物化余额此处**逐批增量减**，每笔 `expire` 的 `balance_after_mp` 取该笔 `UPDATE … RETURNING balance_mp`（步骤④）的真值——同一用户多笔过期的 `balance_after_mp` 因此逐笔递减、与最终物化余额收敛一致（[03-money.md §4.3](03-money.md) 账本逐笔结余口径）。即便某步漂了，紧随其后的 [§11.3](#113-余额对账-cron) 对账会以批次为准重算修平，双保险。消费侧 `ORDER BY expires_at ASC NULLS LAST`（[03-money.md §4.3](03-money.md)）已保证"最早过期先扣、永久批次最后扣"，过期 cron 只兜底清"到期仍有余"的批次。

## 11.3 余额对账 cron

落地 [§22 余额对账](../redesign-requirements.md)：比对**物化余额** `credit_accounts.balance_mp` 与**权威余额** `SUM(credit_lots.remaining_mp 未过期)`，不一致 → 告警 + 以批次为准修正。

```sql
-- 找出所有不平账户（权威 vs 物化）。注意 SUM 用 bigint，见 §11.4
WITH authoritative AS (
  SELECT u.id AS user_id,
         COALESCE(SUM(l.remaining_mp) FILTER (
           WHERE l.remaining_mp > 0 AND (l.expires_at IS NULL OR l.expires_at > now())
         ), 0)::bigint AS auth_mp
  FROM users u LEFT JOIN credit_lots l ON l.user_id = u.id
  GROUP BY u.id
)
SELECT a.user_id, a.auth_mp, ca.balance_mp,
       (a.auth_mp - ca.balance_mp) AS drift_mp
FROM authoritative a JOIN credit_accounts ca ON ca.user_id = a.user_id
WHERE a.auth_mp <> ca.balance_mp;
```

处理：

```ts
const drifts = await sql(reconcileQuery);       // HTTP 只读
if (drifts.length > 0) {
  await alert('balance_reconcile_mismatch', {   // §11.9 告警
    count: drifts.length,
    sample: drifts.slice(0, 20),
    totalDriftMp: drifts.reduce((s, d) => s + Number(d.drift_mp), 0),
  });
  // 以批次为准修正（权威 = lots 之和）。逐账户单语句 UPDATE，幂等（重跑收敛同值）
  for (const d of drifts) {
    await sql`UPDATE credit_accounts SET balance_mp=${d.auth_mp}, updated_at=now()
              WHERE user_id=${d.user_id}`;
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('balance_reconciled',${d.user_id},${JSON.stringify({
                fromMp: d.balance_mp, toMp: d.auth_mp, driftMp: d.drift_mp })})`;
  }
}
```

> 先告警再修正：drift 频繁出现说明某条钱事务漏同步物化余额，是 bug 信号，不能"自愈"掩盖。修正只是兜底，根因得查事务。对账须在 [§11.2](#112-积分过期-cron) 之后跑（先清过期，`未过期` 口径才一致）。

## 11.4 bigint SUM codec（毫积分跨 JSON 的坑）

**单笔金额**（单张 70mp、最大套餐几万 mp）远小于 `2^53`，用 `number` 安全（[02-database.md §3.4](02-database.md) 用 `bigint('x_mp',{mode:'number'})`）。**但看板/对账的 `SUM()` 聚合可能超 `2^53`**（全站累计发放/消耗），`number` 会丢精度，钱就错了。两条取法：

```ts
// ① Drizzle：聚合列显式声明 bigint mode（返回 bigint，自己换算/格式化）
import { sql } from 'drizzle-orm';
const [row] = await db
  .select({ total: sql<bigint>`SUM(${creditLedger.amountMp})`.mapWith(BigInt) })
  .from(creditLedger);
const totalCredits = Number(row.total) / 1000;       // 仅展示层转，注意大数用 BigInt 运算后再转

// ② Neon HTTP：开 raw string，再用 BigInt 解析（Postgres bigint 默认回 string）
import { neon } from '@neondatabase/serverless';
const sql2 = neon(process.env.DATABASE_URL!);
const r = await sql2`SELECT SUM(amount_mp)::text AS total FROM credit_ledger`;
const totalMp = BigInt(r[0].total);                  // ::text + BigInt，绝不经 number
```

红线：**任何 `SUM(*_mp)` / `SUM(*_cash)` 一律 `::text` 或 bigint mode 取，再 `BigInt()` 运算**；只有在最终展示（除以 1000 取小数）那一步才落到 `Number`。看板聚合接口的实现要点与前端消费见 [02-database.md §3.4](02-database.md) 与 [08-frontend.md §9.3](08-frontend.md)。

## 11.5 GB-hour 成本实测（铁律②）

> 上线前**实测单图 compute 成本**，对账 0.07 积分（70mp）定价确认毛利为正。这是铁律②（[README.md 成本铁律表](README.md)）。

成本来源：中转**同步阻塞**，Background Function 整个生图期间按墙钟计费 = `时长 × 内存档`。Netlify Functions 计费单位 GB-hour（约 $0.0000139/GB-s，以官方实时价为准）。

**测算公式**：

```
单图 compute 成本($) = relay_p95_seconds × (函数内存 GB) × 单价($/GB-s)
GB-hour 口径        = relay_p95_seconds/3600 × 函数内存 GB
```

**取数步骤**：
1. 灰度跑 N≥200 张真实生图，从 `generations.duration_ms` 取中转 p50/p95（`duration_ms = completed_at - started_at`，覆盖整段后台 await）。
2. Background Function 内存档**调到能跑通的最低**（生图期主要是空等中转 I/O，CPU/内存几乎不吃，高内存档纯浪费钱）；常见从默认降到 256–512MB，压测验证不 OOM。
3. 把 p95 时长 × 内存档 × 单价算单图成本，填下表对账。

**对账表模板**（上线前必填、连同实测数据归档；¥→$ 按记账汇率）：

| 项 | 实测值 | 备注 |
|---|---|---|
| 中转 p50 时长 | __ s | `duration_ms` 中位 |
| 中转 p95 时长 | __ s | 用 p95 算最坏成本 |
| 函数内存档 | __ MB | 调低后的稳定值 |
| 单图 compute 成本 | $ __ | p95 × 内存 × 单价 |
| 单图中转 API 成本 | $ __ | 中转账单/张（若另计） |
| 单图总成本 | $ __ | compute + 中转 |
| 售价 | 70mp = ¥0.07 ≈ $ __ | 定价 |
| **毛利/张** | $ __ | 售价 − 总成本，**必须 > 0** |

> 若毛利为负：①再降内存档；②抬单张定价（改 `app_config` 单张扣费 mp，[00-overview.md §1.5](00-overview.md)）；③调单日预算阈值压总敞口（[§11.8](#118-旧预算键清理-cron)）。失败的图也烧了 compute 却不扣费——把失败率计入有效成本。

## 11.6 超时重扫 cron

**这是 5min 超时的权威判定**（前端轮询满 5min 只是软超时、释放 UI；服务端 cron 才是终态权威）。落地 [03-money.md §4.6](03-money.md)，与 [04-generation-pipeline.md §5.5](04-generation-pipeline.md) 的前端软超时**区分**：后台卡死/被平台杀掉时，只有 cron 能把僵尸行收成终态、释放并发。

```sql
-- 每分钟跑：超 5min 仍未终态 → failed/provider_timeout（单语句即原子，HTTP 即可）
-- 时间基准用 COALESCE(started_at, updated_at)：兜底"claimed 但还没写 started_at 就被平台杀掉"的僵尸行
-- （与 03-money.md §4.6 超时 WHERE 完全一致）。error_code 归一化枚举见 04-generation-pipeline.md §5.8。
-- duration_ms 一律用 (EXTRACT(EPOCH FROM …)*1000)::int 算（与 03-money.md §4.3 同口径）；
-- 禁用 EXTRACT(MILLISECONDS FROM …)——它只返回"秒"字段的毫秒分量(×1000、上限 59999)、≥1min 被截断，
-- 超时行恰好 ≥5min 必踩此坑（PG 陷阱）。
UPDATE generations
SET status='failed', error_code='provider_timeout', error='provider_timeout', completed_at=now(),
    duration_ms = (EXTRACT(EPOCH FROM now()-COALESCE(started_at, updated_at))*1000)::int, updated_at=now()
WHERE status IN ('claimed','running')
  AND COALESCE(started_at, updated_at) < now() - interval '5 minutes'
RETURNING id, user_id;
```

```ts
const r = await sql(timeoutRescanSql);
for (const g of r) {
  await sql`INSERT INTO events(type,user_id,payload)
            VALUES('image_failed',${g.user_id},${JSON.stringify({
              generationId: g.id, reason: 'provider_timeout' })})`;
}
if (r.length > 0) await alert('queue_timeout_rescan', { count: r.length, ids: r.map(x => x.id) });
```

要点：
- **失败不扣费**（成功才扣，[03-money.md §4.6](03-money.md)），超时路径从不进扣费事务，天然"未扣"，前端失败卡注明"未扣积分"。
- **释放并发 = 状态进终态**：行从 `{queued,claimed,running}` 移出，`COUNT` 自动少一，无双减/漏减（[02-database.md §3.3](02-database.md)）。
- 用 `ix_gen_status_time`（[02-database.md §3.3](02-database.md)）避免全表扫。
- **僵尸 `claimed` 兜底**：若某行 `claimed` 后还没写 `started_at` 就被平台杀掉（占用并发却永不进 running），时间谓词改用 `COALESCE(started_at, updated_at)` 即可命中并收终态，避免漏扫死锁并发（与 [03-money.md §4.6](03-money.md) 一致）。
- 若该行实际已成功但 cron 抢先置 failed？不会——成功事务 `UPDATE … WHERE status='running'`（[03-money.md §4.3](03-money.md)）与本 cron 互斥于行锁/状态谓词，先到先得且都只认中间态，终态行不再被改。

## 11.7 图片清理 cron

落地 [06-storage.md §7.5](06-storage.md) 的调度：删过期 R2 对象 + DB 行 + 写 `events(image_cleaned)` + 孤儿清理。本节只管"什么时候、按什么口径触发"，删除细节与 R2 SDK 调用见 06 章。

```ts
async function runImageCleanup() {
  // ⓪ 到期前 1 天预扫 → 写站内通知（仅"图片到期前 1 天"用存储通知；积分到期走实时字段不入此表，
  //    见 07-api.md §8.3 expiringSoon / 08-frontend.md §9.7）。必须在删图（步骤①）之前做，
  //    否则今晚就到期的图来不及提示。dedupe_key=image_expiring:图id，UNIQUE 兜底重跑/每日不重发同一条。
  await sql`
    INSERT INTO notifications(user_id, type, payload, dedupe_key)
    SELECT user_id, 'image_expiring',
           jsonb_build_object('imageId', id, 'expiresAt', expires_at),
           'image_expiring:'||id
    FROM images
    WHERE expires_at BETWEEN now() AND now() + interval '1 day'
    ON CONFLICT (dedupe_key) DO NOTHING`;          // notifications 表见 02-database.md §3.2
  // ① 到期顺延兜底（money-6）：删前对"已兑过码"的付费用户，把其仍到期的图 expires_at 顺延 60 天。
  //    防"用户已升级付费、旧图却按旧保留期被清"。判定 users.has_paid（兑换升级写入，03-money.md §4.7）。
  //    顺延后这些行不再命中步骤②的 expires_at<now()，本轮不删。
  await sql`
    UPDATE images i SET expires_at = now() + interval '60 days'
    FROM users u
    WHERE i.user_id = u.id AND u.has_paid = true
      AND i.expires_at IS NOT NULL AND i.expires_at < now()`;
  // ② 到期图：保留期已过（免费 7 / 付费 60，升级顺延 60，写在 images.expires_at）
  const expired = await sql`
    SELECT id, generation_id, user_id, storage_key FROM images
    WHERE expires_at IS NOT NULL AND expires_at < now()
    LIMIT 500`;                                   // 分批，防单次超时
  for (const img of expired) {
    await deleteFromR2(img.storage_key);          // 06 章；删失败记录、下轮重试
    await sql`DELETE FROM images WHERE id=${img.id}`;
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('image_cleaned',${img.user_id},${JSON.stringify({
                generationId: img.generation_id, reason: 'retention_expired' })})`;
  }
  // ③ 孤儿 R2 对象：扣费事务 ROLLBACK 留下的"传了 R2 但没落 images 行"的对象
  //    （03-money.md §4.3 提到的孤儿），按 key 前缀对账 R2 listing vs images.storage_key 删除
  await sweepOrphanR2Objects();                   // 06 章
}
```

口径要点：**保留期权威在 `images.expires_at`**（清理只删 `expires_at < now()`），免费/付费天数与升级顺延的写入逻辑在 [06-storage.md §7.4](06-storage.md) 与 [03-money.md §4.7](03-money.md)（兑换升级顺延）。`events(image_cleaned)` 是 append-only，历史图删了看板数据也不丢（[02-database.md §3.2](02-database.md)）。删 R2 与删 DB 顺序：**先删 R2 再删 DB 行**（反过来会留孤儿对象）。

执行顺序固定 **⓪预扫通知 → ①付费顺延兜底 → ②删图 → ③扫孤儿**：
- **⓪到期前 1 天预扫通知**：把"次日内将到期"的图写入 `notifications`（`type='image_expiring'`、`dedupe_key='image_expiring:'||id`、`ON CONFLICT(dedupe_key) DO NOTHING`），cron 每日重跑/重复触发不重发同一条。**仅"图片到期前 1 天"用这张存储通知表**；积分到期提示走 `/api/me` 的实时字段 `expiringSoon`（[07-api.md §8.3](07-api.md) / [08-frontend.md §9.7](08-frontend.md)），不入此表。通知表 schema 见 [02-database.md §3.2](02-database.md)，读写端点 `GET /api/notifications` / `POST /api/notifications/read` 见 [07-api.md §8.3](07-api.md)，顶栏铃铛 UI 见 [08-frontend.md §9.2/§9.6](08-frontend.md)。
- **①付费顺延兜底（money-6）**：删图前对 `users.has_paid=true` 的用户，把其"已到期"的图 `expires_at` 顺延 60 天，避免"已兑码升级却被按旧保留期清"的图被误删；顺延后这些行不再命中步骤②。`has_paid` 由兑换升级写入（[03-money.md §4.7](03-money.md)）。

## 11.8 旧预算键清理 cron

预算计数的**存储与判断口径权威在 [04-generation-pipeline.md §5.6](04-generation-pipeline.md)**，配合入队前的熔断闸（[03-money.md §4.9](03-money.md)）。计数按**日期拼进 key**存：`app_config` 行 `key='relay_budget:'||today`（`today` = 服务端约定时区 Asia/Shanghai 当日 `YYYY-MM-DD`），`value_json = { "calls": int, "ms": int }`。**字段名 `calls` / `ms`**（不是 `compute_ms`）。

跨天靠**新日期键自动归零**（次日 key 不存在 → 计数从 0 起），**不需要**显式清零；因此本 cron 角色降为「清理/归档旧日期键 + 近阈告警」，**不**再 upsert 固定行清零：

```sql
-- 每日 0 点（北京）：归档/删除昨日及更早的预算键（保留近 N 天供看板回溯，其余删）
-- 当日键无需任何操作——date-in-key 已让它天然从 0 起
DELETE FROM app_config
WHERE key LIKE 'relay_budget:%'
  AND substring(key from 'relay_budget:(.*)') < to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '7 days','YYYY-MM-DD');
```

```ts
// 入队闸消费侧权威实现见 03-money.md §4.9 isDailyBudgetExhausted(c)：用同一事务 client c 读"当日 key"。
// 计数键带日期，读不到当日键即视为 0（跨天自动作废，无须清零）。
function isDailyBudgetExhausted(cfg, env) {
  const { calls = 0, ms = 0 } = cfg ?? {};         // cfg = 当日 key 的 value_json，读不到则 {}
  return calls >= Number(env.DAILY_RELAY_BUDGET_CALLS)
      || ms >= Number(env.DAILY_RELAY_BUDGET_MS);
}
```

> 递增时机（与 [04-generation-pipeline.md §5.6](04-generation-pipeline.md) 一致）：`calls` 的硬上限递增 = 与 `calls < DAILY_RELAY_BUDGET_CALLS` 判断**同一条原子语句**，在 Background Function 抢占成功、**调中转前**执行（先 `INSERT … ON CONFLICT DO NOTHING` 保证当日 key 行存在，再 `UPDATE … jsonb_set(calls=calls+1) WHERE … AND (value_json->>'calls')::bigint < DAILY_RELAY_BUDGET_CALLS RETURNING`，affected=0 即越界→不调中转、置该 generation `failed/insufficient_quota`，详见 [04-generation-pipeline.md §5.6](04-generation-pipeline.md)）；`ms` 在**调中转后** `finally` 里 HTTP `+= duration_ms`（仅监控/告警、**不硬挡**）。阈值 `DAILY_RELAY_BUDGET_CALLS/MS` 来自 env（[00-overview.md §1.4](00-overview.md)）。

`ms` 键易被平台"杀进程"导致少计（`finally` 没跑完），所以本 cron 额外用**当日 `generations.duration_ms` 之和重算覆盖 `ms` 键**，作为权威值（与 [04-generation-pipeline.md §5.6](04-generation-pipeline.md) 硬上限口径一致：硬挡看 `calls`，`ms` 仅监控并以重算值为准）：

```sql
-- 每日 0 点（北京）随旧键清理一并跑：用当日所有 generations 的 duration_ms 之和重算覆盖当日 ms 键
-- （平台杀进程会丢 finally 的 incMs，故以 generations 落库时长为权威，BIGINT 求和防溢出）
WITH today_ms AS (
  SELECT COALESCE(SUM(duration_ms), 0)::bigint AS ms
  FROM generations
  WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai')
)
INSERT INTO app_config(key, value_json)
SELECT 'relay_budget:'||to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),
       jsonb_build_object('calls', 0, 'ms', (SELECT ms FROM today_ms))
ON CONFLICT (key) DO UPDATE
  SET value_json = jsonb_set(app_config.value_json, '{ms}', to_jsonb((SELECT ms FROM today_ms)));
  -- 只覆盖 ms 路径，保留 calls（calls 是调中转前抢占式 +1 的硬上限计数，不可被重算冲掉）
```

本 cron 顺带做**近阈告警**：`calls` ≥ `DAILY_RELAY_BUDGET_CALLS` 的 80%、或**重算后**的 `ms` ≥ `DAILY_RELAY_BUDGET_MS` 的 80% 即报（告警以重算值为准，避免少计 ms 漏告警）。

> **⚠️ 实现修正（错峰告警的时点陷阱）**：本 cron 跑在**北京 00:00**（新一天起点），此刻"当日"key 的 `calls`/`ms`≈0——若用上面 SQL 评估"当日"，近阈/熔断告警**恒为假、是死代码**（cron 链路对抗审查 alerting-major）。故实现上：**① 本 cron 改评估"已结束的前一天"**（`now() AT TIME ZONE 'Asia/Shanghai' - interval '1 day'` 的 key + 同窗 `generations.duration_ms` 重算），作为**昨日回溯日报**（"昨天到了 X% 敞口"）；② **真正的"熔断命中即告警"放在生图管线**——`src/server/generation/process.ts` 硬上限命中分支（`incCallIfUnderCap()` 返 false 处，[04 §5.6](04-generation-pipeline.md)）当场 `alert('daily_budget_exhausted', …)`，用当日 key 上的 `alerted` 标记原子去重做到"每天首次即发"（[§11.9](#119-可观测与告警) daily_budget_exhausted「命中即报（每天首次）」）。这样防破产硬上限被击中时站长**当天即收到告警**，不必等到次日 cron。

## 11.9 可观测与告警

落地 [§23 可观测性与告警](../redesign-requirements.md)。两条出口：**Sentry**（异常/性能追踪，服务端 `SENTRY_DSN`，前端可选 `VITE_SENTRY_DSN_CLIENT`，[00-overview.md §1.4](00-overview.md)）+ **`ADMIN_ALERT_WEBHOOK`**（业务阈值告警，推到站长 IM/webhook）。

```ts
// src/server/alert.ts —— 统一告警出口
export async function alert(kind: AlertKind, detail: unknown) {
  Sentry.captureMessage(`[alert] ${kind}`, { level: 'warning', extra: { detail } });
  const url = process.env.ADMIN_ALERT_WEBHOOK;
  if (url) await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, detail, at: new Date().toISOString() }),
  }).catch(e => Sentry.captureException(e));       // 告警自身失败也要进 Sentry
}
```

**告警项与阈值建议**：

| 告警 kind | 触发条件 | 阈值建议 | 来源 |
|---|---|---|---|
| `daily_budget_exhausted` | 当日中转预算达上限、入口开始拦截 | 命中即报（每天首次） | [§11.8](#118-旧预算键清理-cron) |
| `balance_reconcile_mismatch` | 物化余额 vs 批次和不平 | 任一账户 drift≠0 即报 | [§11.3](#113-余额对账-cron) |
| `queue_timeout_rescan` | 单次重扫置 failed 的数量 | >0 报；单次 >5 升级（疑后台批量挂） | [§11.6](#116-超时重扫-cron) |
| `queue_backlog` | `queued` 行数 / 最老 `queued` 等待时长超阈（积压，非超时） | `queued` 行 >N 或最老等待 >M 分钟 | 看板⑥队列健康 [09-admin.md §10.7](09-admin.md) |
| `relay_success_rate_low` | 中转近 1h 成功率 | <90% 警、<70% 急 | `events(image_succeeded/failed)` 聚合 |
| `relay_latency_high` | 中转 p95 时长 | >相对基线 2× 或 >180s | `generations.duration_ms` |
| `balance_low_overall` | 账面负债接近预算/余额耗尽 | 站长视成本设 | 看板 [§9](../redesign-requirements.md) |
| `redeem_anomaly` | 兑换失败率/429 暴涨（疑刷码） | 单 IP/账号 10min 内 >N 次失败 | [03-money.md §4.7](03-money.md) 限流 |
| `cron_failed` | 任一 cron handler 抛异常 | 命中即报 | [§11.1](#111-scheduled-总览) |

> 规格 [§23](../redesign-requirements.md)「队列积压与超时」两类风险分别由 `queue_backlog`（积压：`queued` 堆积/久等，数据源看板⑥）与 `queue_timeout_rescan`（超时：[§11.6](#116-超时重扫-cron) 重扫置 failed）两条告警并列覆盖。
>
> "每日扣费数 vs 中转账单差异"（[§23](../redesign-requirements.md)）属人工对账：用 `SUM(credit_ledger debit)` 笔数对中转账单笔数（[§11.4](#114-bigint-sum-codec毫积分跨-json-的坑) bigint 取法），月度核一次，差异即可能有"扣了费没成图"或"成图没记账"，回查 events。

## 11.10 测试与 CI

### 钱链路：对真 Neon 分支库跑事务测试（Vitest）

钱/码的并发与重试正确性**只能对真 Postgres 验**（`FOR UPDATE` 行锁、部分唯一索引、`UPDATE…RETURNING` 原子性在内存 mock 里复现不了）。每个 PR 起一条 Neon 分支库（[02-database.md §3.5](02-database.md)）跑迁移后测。**必含用例**：

| 用例 | 验什么 | 断言 |
|---|---|---|
| 并发双击兑换 | 同码两请求并发 | 仅 1 次 `affected=1` 入账，另一次 404/410；批次只建 1 个（[03-money.md §4.7](03-money.md)） |
| 平台重试重入扣费 | 同 `generation_id` 调扣费事务两次 | `uq_debit` 命中，只扣 1 次 70mp、images 只 1 行（[03-money.md §4.3.1](03-money.md)） |
| 抢占式状态机 | 同 generation 两个后台实例并发 | 仅 1 个 `queued→claimed` 成功、另一个 `affected=0` 退出（[03-money.md §4.5](03-money.md)） |
| FIFO 跨批次 | 多批次、最早过期先扣、跨批扣够 70mp | 各批 `remaining` 不出负、永久批次最后扣（[03-money.md §4.3](03-money.md)） |
| 过期清零幂等 | 过期 cron 跑两次 | 第二次 `uq_expire_lot` 命中跳过，余额不重复减；永久批次不动（[§11.2](#112-积分过期-cron)） |
| 注册原子发放 | 注册回调重试两次 | `uq_grant_signup` 保证只发一次 140mp（[03-money.md §4.4](03-money.md)） |
| 入队双闸 | 余额不足 / 并发满 | 402 不入队不扣费 / 409 超并发（[03-money.md §4.9](03-money.md)） |
| 超时重扫 | `running` 行 started_at 拨早 6min | 置 `failed/provider_timeout`、并发释放、未扣费（[§11.6](#116-超时重扫-cron)） |
| 余额对账 | 人为制造 drift | 检出 + 以批次修正收敛（[§11.3](#113-余额对账-cron)） |

并发用例用 `Promise.all` 真并发发两条同参事务（不串行），断言其一成功其一被幂等/锁挡掉。测试连 `DATABASE_URL_UNPOOLED`（direct，跑 `FOR UPDATE`）。

### Playwright 冒烟（关键路径不回归）

一条端到端冒烟：**登录 → 生图（轮询到 succeeded）→ 看图（读 R2 `public_url`）→ 兑换码 → 余额增加**。中转在冒烟环境用桩/录制响应（避免真烧钱），断言五态流转（[08-frontend.md §9.4](08-frontend.md)）与扣费后余额变化。

### Biome + GitHub Actions 门禁

```yaml
# .github/workflows/ci.yml（要点）
jobs:
  ci:
    steps:
      - run: pnpm biome ci .                       # lint + format 检查
      - run: pnpm tsc --noEmit                     # typecheck
      - run: pnpm vitest run                       # 钱链路对 PR 专属 Neon 分支（DATABASE_URL_UNPOOLED 注入）
      - run: pnpm build                            # vite build
      - run: pnpm tsx scripts/assert-no-secrets-in-bundle.ts   # 构建期密钥断言（见下）
```

流水线顺序 **lint → typecheck → test → build → 密钥断言**，任一失败阻断合入：

- **每 PR 一条 Neon 分支**：CI 用 Neon API 按 PR 创建分支库 → 跑迁移 → 注入 `DATABASE_URL_UNPOOLED` 给测试 → PR 关闭时销毁分支。隔离、可对真库跑、互不污染。
- **构建期密钥断言**（`assert-no-secrets-in-bundle.ts`）：`vite build` 后扫 `dist/`，断言 `RELAY_API_KEY`/`RELAY_BASE_URL`/`DATABASE_URL*`/`R2_SECRET_*`/`BETTER_AUTH_SECRET` 的**值与名**均未出现，命中即 `exit(1)`。这是密钥红线的 CI 兜底，泄露代码无法合入。实现见 [00-overview.md §1.4](00-overview.md)。

### 收尾红线清单

- [ ] 每条 cron 幂等（可重复触发/手动重跑不出错）+ `try/catch` 上报，不静默吞。
- [ ] 过期/对账走 Pool/WS 事务；只读扫描走 HTTP；cron 错峰排（过期 → 对账）。
- [ ] 所有 `SUM(*_mp)` 用 `::text`/bigint mode + `BigInt()`，绝不经 `number`（[§11.4](#114-bigint-sum-codec毫积分跨-json-的坑)）。
- [ ] 超时重扫是 5min **权威**判定；前端软超时只释放 UI（[§11.6](#116-超时重扫-cron)）。
- [ ] 上线前填完 GB-hour 对账表、确认毛利为正（铁律②，[§11.5](#115-gb-hour-成本实测铁律)）。
- [ ] 单日预算熔断触发即告警（防破产硬上限，[§11.8](#118-旧预算键清理-cron)）。
- [ ] 钱链路 9 类用例对真 Neon 分支跑通；CI 含密钥断言。
