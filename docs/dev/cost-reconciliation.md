# 成本对账（上线闸 · 铁律②）

> **上线前必过的硬闸**：实测单图 compute 成本，对账 0.07 积分（70mp）定价，**毛利 > 0 才上线**。
> 方法论真相源 [10-ops-test.md §11.5](10-ops-test.md)；定价/计费规则见 [redesign-requirements.md §22](../redesign-requirements.md) + [CLAUDE.md 成本铁律](../../CLAUDE.md)。
> **本文件 = 方法论 + 上线前必填的对账表（占位待灰度跑量后填实测数）。** 真·毛利数需上线跑量 ≥200 张才能填。

## 为什么是上线闸

中转 `api.tangguo.xin` 是**同步阻塞**：Background Function 在整个生图期间按墙钟（wall-clock）计费 = `时长 × 内存档`。Netlify Functions 计费单位 **GB-hour**（约 $0.0000139/GB-s，**以官方实时价为准**）。慢图代价 D（成功才扣的代价）+ 失败也烧 compute 却不扣费——若单图成本逼近/超过 0.07 积分售价，**每出一张就亏一张**，必须在放量前用真实数据确认毛利为正。

## 测算公式

```
单图 compute 成本($) = relay_p95_seconds × (函数内存 GB) × 单价($/GB-s)
GB-hour 口径        = relay_p95_seconds / 3600 × 函数内存 GB
单图总成本($)       = compute 成本 + 单图中转 API 成本（若另计账单）
有效成本($)         = 单图总成本 ÷ 成功率   ← 失败的图也烧 compute 却不扣费，须把失败率折进成本
毛利/张($)          = 售价(70mp = ¥0.07 ≈ $X) − 有效成本     ← 必须 > 0
```

## 取数步骤

1. **灰度跑 N ≥ 200 张真实生图**（覆盖不同尺寸/质量分布，贴近真实流量）。从 `generations` 取：
   - `duration_ms` 的 **p50 / p95**（`duration_ms = completed_at − started_at`，覆盖整段后台 await，[02 §3.4](02-database.md) integer ms）。
   - **成功率** = `count(status='succeeded') ÷ count(status IN ('succeeded','failed'))`（事件源 `events(image_succeeded/failed)` 亦可聚合）。
   - 取数 SQL 示例（HTTP 只读，灰度窗口按 `created_at` 限定）：
     ```sql
     SELECT
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
       count(*) FILTER (WHERE status='succeeded')::float
         / NULLIF(count(*) FILTER (WHERE status IN ('succeeded','failed')), 0) AS success_rate,
       count(*) FILTER (WHERE status='succeeded') AS n_succeeded
     FROM generations
     WHERE created_at >= now() - interval '14 days';   -- 按灰度窗口调整
     ```
2. **Background Function 内存档调到能跑通的最低**：生图期主要是空等中转 I/O，CPU/内存几乎不吃，高内存档纯浪费钱。常见从默认降到 **256–512MB**，压测验证不 OOM（满 N 张无 OOM/超时）。
3. **用 p95 时长 × 内存档 × 单价**算单图成本（p95 算最坏成本），把成功率折进有效成本，填下表。

## 对账表（上线前必填 · 连同实测数据归档）

> ¥→$ 按记账汇率换算；下方为**占位**，灰度跑量后用步骤 1–3 的实测值替换。

| 项 | 实测值 | 口径/备注 |
|---|---|---|
| 灰度样本数 N | `__`（≥200） | `n_succeeded` |
| 中转 p50 时长 | `__` s | `duration_ms` 中位 |
| 中转 p95 时长 | `__` s | 用 p95 算最坏成本 |
| 成功率 | `__` % | 折进有效成本 |
| 函数内存档 | `__` MB | 调低后压测稳定值（256–512MB 常见） |
| GB-s 单价 | `$ __` /GB-s | Netlify 官方实时价（≈$0.0000139） |
| 单图 compute 成本 | `$ __` | p95(s) × 内存(GB) × 单价 |
| 单图中转 API 成本 | `$ __` | 中转账单/张（若另计） |
| 单图总成本 | `$ __` | compute + 中转 |
| **有效成本/张** | `$ __` | 总成本 ÷ 成功率 |
| 售价 | 70mp = ¥0.07 ≈ `$ __` | 定价（`app_config.price_per_image_mp`） |
| **毛利/张** | `$ __` | 售价 − 有效成本，**必须 > 0** |

## 毛利为负时的处置（按优先级）

1. **再降内存档**（256→128MB，压测验证不 OOM）——compute 成本与内存档线性相关，最直接。
2. **抬单张定价**：改 `app_config.price_per_image_mp`（[00 §1.5](00-overview.md)，后台 ⑥ 参数页可改），即时生效、不改码。
3. **调单日预算阈值压总敞口**：`DAILY_RELAY_BUDGET_CALLS/MS`（[10 §11.8](10-ops-test.md)），限制每日最大亏损面。
4. 换更便宜的中转/内存换时长方案（架构层，重）。

## 上线 checklist（铁律②）

- [ ] 灰度 ≥200 张，取得 p50/p95/成功率（上方 SQL）。
- [ ] 内存档调到稳定最低并压测不 OOM。
- [ ] 对账表全部填实测值。
- [ ] **毛利/张 > 0**（把失败率折进有效成本后仍为正）。
- [ ] 实测数据与本表一并归档（PR/运维记录）。
- [ ] 单日预算阈值（calls/ms）按毛利与可承受敞口设定，熔断告警接 `ADMIN_ALERT_WEBHOOK`（[10 §11.9](10-ops-test.md)）。

> 毛利未确认为正前 **不放量**。这是站长「不破产」的最后一道商业闸，与技术闸（钱链路真库测试、密钥断言、cron 幂等）并列。
