# 阶段二施工计划（已批准）· 账号 + 积分 + 存储（接真后端）

> **本文件 = 阶段二的可执行蓝图 + 可勾选清单**（站长 2026-06-21 批准）。
> **怎么写代码看 [docs/dev/02–11](README.md)**（DDL/钱链路 SQL/签名都在那）；**做什么/顺序/红线/外部依赖看这里**；**进度勾选在本文件 + [PROGRESS.md](../PROGRESS.md) 联动**。
> 钱链路一律以 **03-money / 04-generation-pipeline** 为准。每做完一项当场把 `[ ]` 改 `[x]`。

## Context
阶段一（对话式三栏壳 + 五态 + 灵感画廊 + 充值/账号 mock，RR8 framework 模式）已签字并合并进 `main`（`4f81022`）。阶段二接真后端：Neon Postgres + Drizzle + Better Auth + Cloudflare R2 + Netlify Functions + 积分账本/扣费/兑换钱链路 + 生图管线（DB-as-queue）。**钱不能错是命门**——成功才扣 + 幂等、防双花。严格依赖顺序：**地基 → 鉴权 → 钱链路 → 管线 → 前端接真 → 后台 → cron/测试/上线闸**。

> 栈版本：实际用 **React Router 8**（= docs 的「RR7 framework 模式」）。钱/码走 `Pool/WS + FOR UPDATE`（`DATABASE_URL_UNPOOLED`）；看板/单语句走 `neon()` HTTP（`DATABASE_URL`）。

---

## §0 外部依赖（站长开通/提供 — 决定何时能接真服务）

| 服务 | 变量 | 何时需要 | 状态 |
|---|---|---|---|
| **Neon Postgres**（AWS 美东，与 Netlify 同区） | `DATABASE_URL`(pooled) · `DATABASE_URL_UNPOOLED`(direct) · 每 PR 一个 test branch | ①起 | ⬜ 待开通 |
| **Cloudflare R2**（公有 bucket + 自定义域，非 *.r2.dev） | `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_PUBLIC_BASE_URL` | ① | ⬜ 待开通 |
| **Better Auth** | `BETTER_AUTH_SECRET`(可生成) · `BETTER_AUTH_URL` | ② | ⬜ |
| **中转**（v1 已有，确认） | `RELAY_API_KEY` · `RELAY_BASE_URL`(+可选 `RELAY_BASE_URL_BACKUP`) · `DAILY_RELAY_BUDGET_CALLS/_MS` | ④ | ⬜ 确认 |
| 可观测/告警（可后补） | `SENTRY_DSN` · `ADMIN_ALERT_WEBHOOK` | ⑦ | ⬜ |
| 第三方店铺购买 URL | 套餐 `redirect_url` | ⑥（可占位） | ⬜ |

> **可立即离线开工（不需密钥）**：① 的 Drizzle schema/迁移/seed、④ 的契约（`src/contracts/*`）/relay 封装/失败归一。建议站长并行开通 Neon + R2。
> **隔离**：在 `main` 上新建 `phase2` 工作分支推进。

---

## §1 地基（Foundation）— 连接 / 表 / 存储（无钱逻辑）
- [ ] 装依赖：drizzle-orm · drizzle-kit · @neondatabase/serverless · ws · @aws-sdk/client-s3 · zod · drizzle-zod · @types/ws（`package.json`）
- [ ] **DB 双连接** `src/db/db.server.ts`：`getPool()`(Pool/WS over `DATABASE_URL_UNPOOLED`，`neonConfig.webSocketConstructor=ws`) 给事务；`sql=neon(DATABASE_URL)` HTTP 给看板/单语句。开-用-关单 handler 内，不跨请求复用
- [ ] **Schema** `src/db/schema.ts`：13 张业务表（users/credit_accounts/credit_lots/credit_ledger/packages/redeem_codes/conversations/generations/images/audit_log/notifications/events/app_config），金额列 `bigint`(`_mp`/`_cash`)，全二级索引 + **5 个部分唯一索引**(uq_debit/uq_refund/uq_grant_signup/uq_credit_code/uq_expire_lot，均 ON `credit_ledger(ref_id)` + WHERE 谓词) + `uq_notif_dedupe`
- [ ] **迁移** `drizzle.config.ts` + `drizzle/*.sql`：`drizzle-kit generate` 后**人工核对** 5 个 partial-unique 的 WHERE 在 SQL 里（drizzle 推断不可靠），缺了手写补迁移
- [ ] **种子** `src/db/seed.ts`：admin(注册后翻 role) · packages(¥9.9→990/10000mp，¥29.9→2990/32000mp) · app_config(70/140/30/7/60/2 + 预算阈值)
- [ ] **R2** `src/server/r2.server.ts`：`putToR2(userId,generationId,relayImage)` · `buildStorageKey`={uid}/{yyyy}/{mm}/{genId}-{rand}.png(crypto rand 防猜) · `publicUrl()` · `retentionExpiry(user,cfg)` · 删除助手；S3Client `region:'auto'`，`CacheControl: immutable`

🔴 **红线**：金额整数（绝不 float/NUMERIC）；`users.id` 无 DB default（鉴权 hook 写 Better Auth UUID）；两种连接不可混用（防双花读改写必须 Pool/WS+FOR UPDATE）；storage_key 的 rand 段是唯一软隔离，前端只读 public_url、绝不拼 key/碰中转临时 URL。
✅ **验证**：连真库跑迁移 + FOR UPDATE 锁冒烟 + putToR2 往返拿到可访问 public_url。

## §2 鉴权（Better Auth）
- [ ] 钉版装包：better-auth + admin 插件**精确钉版**(避 multi-session CVE，不启 multi-session) + bcryptjs
- [ ] **单实例** `src/lib/auth.ts`：email+password(min6/max72 字节断言/autoSignIn/不验邮箱) · session(7d/updateAge24h/cookieCache300s) · `advanced.database.generateId:'uuid'`(**字面量**) · admin 插件 · databaseHooks
- [ ] `@better-auth/cli generate` 生成 user/session/account/verification（同库，**不写进 schema.ts**），确认 user.id 原生 uuid
- [ ] catch-all handler `app/routes/api.auth.$.ts` / `netlify/functions/auth.ts`：loader+action=`auth.handler(request)`
- [ ] 密码契约 `src/contracts/auth.ts`：Zod min6 + `TextEncoder().encode(p).length<=72`
- [ ] 守卫 `src/lib/guard.ts`：`requireUser`(普通读) · `requireUserStrict`(敏感路径 disableCookieCache + 查业务 users role/banned/并发) · `requireAdmin`
- [ ] 注册发放钩子 `src/lib/auth-hooks.ts`：`onUserRegistered`(单事务原子发 0.14，复用 ③ grant) · `onSessionCreated`(孤儿账号惰性补发)
- [ ] 封禁/改密 route：走 Better Auth API(自动吊销会话) + 同步 audit

🔴 **红线**：`generateId:'uuid'` 必须字面量；**bcrypt 72 字节断言在 `password.hash` 内**；敏感/钱/封禁路径必须 disableCookieCache 每请求查 DB；会话存废只走 Better Auth API；signup grant 靠 `uq_grant_signup` 幂等、钩子失败→注册失败。

## §3 钱链路（命门 — 最不容错）
> 全部走 `src/server/tx.server.ts`(Pool/WS+FOR UPDATE)；SQL 照 03-money 逐条落 TS。
- [ ] `src/server/tx.server.ts`：`tx(async c=>…)` connect→BEGIN→COMMIT/ROLLBACK→release
- [ ] **预算熔断（铁律①）** `src/server/budget.server.ts`：软闸 `isDailyBudgetExhausted(c)` + **硬上限** `incCallIfUnderCap()`=`UPDATE…WHERE calls<阈值 RETURNING`(原子防 TOCTOU) + `incMs`
- [ ] **入队三闸** `src/server/generation/enqueue.ts`：并发(409)/余额(402，**只判不扣**)/软预算(429) + 建会话 + `INSERT generations(queued)` **同一 FOR UPDATE 事务** → 202
- [ ] **抢占状态机（铁律③）** `src/server/money/preempt.server.ts`：`claim`=`UPDATE…WHERE status='queued' RETURNING`(后台第一步，affected=0 即退) · `markRunning` 写 started_at
- [ ] **扣费（核心）** `src/server/money/debit.server.ts`：putToR2 在**事务外**；事务内 **⓪双守卫**(⓪a `SELECT status FOR UPDATE` 断言 running · ⓪b 探 uq_debit 已存在→幂等 no-op) → ① FIFO 锁 lots(`ORDER BY expires_at ASC NULLS LAST,created_at ASC`) → ② 扣 `charged`(实扣量、不出负、零头记 credit_shortfall) → ③ `INSERT images ON CONFLICT(generation_id) DO NOTHING` → ④ 物化余额 `-charged` RETURNING → ⑤ ledger debit(uq_debit ON CONFLICT) → ⑥ generations→succeeded + `duration_ms=(EXTRACT(EPOCH…)*1000)::int` + events
- [ ] 兑换 `src/server/money/redeem.server.ts`：`UPDATE…WHERE status='active' RETURNING`→0 行再查状态分 404/410；同事务入账 lots+ledger(uq_credit_code)+余额；首兑升级 has_paid + 旧图顺延 60 天；失败限流 5/10min
- [ ] 注册发放 `src/server/money/grant.server.ts`：单事务 users+account+signup lot+ledger(uq_grant_signup)+events，GRANT_MP/有效期读 app_config
- [ ] 过期 `src/server/money/expire.server.ts`：每日 FIFO 清零到期 lot(永久 lot 跳过)，uq_expire_lot 幂等
- [ ] 调账 `src/server/money/adjust.server.ts`：admin ±，**同事务动 credit_lots + 物化余额 + ledger(adjust) + audit**，记真实 moved 量，不出负
- [ ] 对账 `src/server/money/reconcile.server.ts`：每日 `SUM(lots.remaining)` vs 物化余额，**先告警再以 lots 为准修正**

🔴 **红线**：⓪双守卫是扣费事务**第一步**(同时挡重入重复扣 & 超时翻 failed 后仍扣)；**成功才扣**；ledger/lots/物化余额三者用同一 charged、balance_after 取 RETURNING；`duration_ms` 用 `EXTRACT(EPOCH…)*1000`（绝不 `EXTRACT(MILLISECONDS…)`）；预算硬上限原子条件自增；adjust 必动 lots；5 个 partial-unique 迁移后人工核对 WHERE。

## §4 生图管线 + API 契约
- [ ] 契约 `src/contracts/{error,generate,redeem,me,notification,conversation,image,package,inspiration,account}.ts`：统一错误信封 + `GenerateStatusResponse` 判别联合 + SIZES + 6 值 ERROR_CODES + `REDEEM_CODE_RE`；单笔 number、SUM string codec（注：`generate.ts` 阶段一已有雏形，补全）
- [ ] **relay 封装（铁律④）** `src/server/relay.ts`：Key 只从 `process.env.RELAY_API_KEY`；主/备 Base；AbortController 4.5min 软超时→provider_timeout；F-429(HTTP200+error body)守卫；**AbortError 不重试**；复用 v1 `imageGeneration.ts` build/parse + `redaction.ts`
- [ ] 失败归一 `src/server/generation/failure.ts`：先脱敏 → 6 值枚举，message≤500
- [ ] 提交(同步) `netlify/functions/generate.ts`：requireUserStrict→parse→enqueue→`triggerBackground`(fire-and-forget，body 仅 `{generationId}`)→202；**绝不 await relay**
- [ ] 后台(15min) `netlify/functions/generate-background.ts`：`-background` 后缀；claim→running→预算硬闸→callRelay→putToR2→debit；catch→归一 failed；finally→incMs
- [ ] 状态 `netlify/functions/generate-status.ts`：`WHERE id AND user_id`(owner-scoped 否则 404)→判别联合；失败也 200；只回 R2 public_url
- [ ] 清死代码：删 `src/server/{jobStore,imageProxy}.ts`、`asyncImageJob.ts` 去 Blobs；全链路无 apiKey
- [ ] 限流 `src/server/rateLimit.ts`：DB 计数窗口(redeem 5/10min、sign-in 10/10min、sign-up 5/hr，只计失败)
- [ ] 前端接真：`src/mocks/api.ts`→真 fetch；`src/hooks/useGeneration*.ts` TanStack Query 2s 轮询、终态停、5min 前端软超时(仅释放 UI)

🔴 **红线**：同步函数不 await relay；`-background` 后缀=真后台；claim 铁律③；预算硬闸在 relay 前；putToR2 在扣费事务外；失败不进扣费事务；回前端脱敏、只给 R2 public_url；生成不可取消。

## §5 前端业务页接真（换 mock 不改结构）
- [ ] 充值/资产库/本次面板/历史会话 → loader(SSR) + REST(写) 接真；删 `src/mocks/*`，MockProvider 改真数据源
- [ ] 余额(`["me","balance"]`)/job/列表统一 TanStack Query(loader 作 initialData)；成功后 invalidate 余额/面板/资产
- [ ] 并发提示(409) · 积分过期黄点(`/api/me` expiringSoon) · 通知铃铛(`/api/notifications`) 接真
- [ ] 资产库**批量管理**(框选 + 吸底操作条 + zip + 删除带确认，§24.9)——阶段一是占位，此阶段做实

## §6 后台管理（`/admin/*` — 阶段一完全没建）
- [ ] 守卫 + 公共件：`src/server/requireAdmin.ts` · `src/contracts/admin.ts`(含 `REDEEM_ALPHABET`) · `src/server/{audit,alert}.ts`(writeAudit 同事务)
- [ ] 兑换码 `netlify/functions/admin-codes-*.ts`：批量生成(CSPRNG `crypto.randomInt`)+套餐快照 · CSV 导出(BOM) · 查单 · 作废批次(只动 active) · 对账
- [ ] 用户 `netlify/functions/admin-users-*.ts`：搜索/详情/封禁(吊销会话)/改密(吊销+不记明文)/并发；**调积分走 ③ adjust**
- [ ] 灵感库 `netlify/functions/admin-inspirations*.ts` + 建 `inspirations` 表：CRUD + 封面传 R2 + audit
- [ ] 生成记录 `netlify/functions/admin-generations.ts`：近 7 天/50 条/倒序；失败直显 error_code/error/http_status；纯记录
- [ ] 套餐+参数+审计 `netlify/functions/admin-{packages,config,audit}.ts`：套餐软删 active=false(FK RESTRICT，**禁 CASCADE**)；config 即时生效；audit 只读只追加
- [ ] 看板 `netlify/functions/admin-dashboard.ts` + `src/server/sumCodec.ts`：7 卡 events 聚合；**所有 SUM 走 string/bigint codec**
- [ ] 后台 UI `app/routes/_admin.*.tsx` + `ConfirmDialog`：独立 `_admin` 布局(requireAdmin loader)；贴 design-system；敏感写**二次确认**

🔴 **红线**：双守卫(布局 loader + 每个 API 各自 requireAdmin)；钱/码 audit 同事务；套餐禁硬删/禁 CASCADE；SUM 不走 number；二次确认。

## §7 cron / 可观测 / 测试 / 上线闸
- [ ] 5 个 Scheduled `netlify/functions/cron-{timeout-rescan,expire-credits,reconcile-balance,clean-images,budget-cleanup}.ts` + `netlify.toml`：错峰(rescan 每分钟、budget 00:00、expire 00:10、reconcile 00:30、clean 01:00)；钱 cron 走 Pool/WS、扫描走 HTTP；各 try/catch→告警
- [ ] 可观测 `src/server/{sentry,alert}.ts`：Sentry + `ADMIN_ALERT_WEBHOOK`
- [ ] 密钥断言 `scripts/assert-no-secrets-in-bundle.ts` 挂 CI
- [ ] CI `.github/workflows/ci.yml`：biome→tsc→vitest→build→assert-no-secrets
- [ ] **钱链路 9 例真库测试** `tests/money/*.test.ts` + `tests/setup/neon-branch.ts`：对真 Neon 分支 `Promise.all` 并发(双击兑换/重入扣费/抢占/FIFO 跨批/过期幂等/注册发放/入队双闸/超时重扫/对账)
- [ ] Playwright 冒烟 `tests/e2e/*`：注册→生图→兑换
- [ ] **成本对账（铁律②·上线闸）** `docs/dev/cost-reconciliation.md`：灰度 ≥200 张取 p95，调最低内存档，算单图成本对账 0.07，**毛利>0 才上线**

🔴 **红线**：cron 错峰(expire 先于 reconcile)；EXTRACT(EPOCH)*1000；失败率折进成本；毛利>0 才上线。

---

## 验证（端到端 + 命门）
1. 真库迁移 + FOR UPDATE 真锁冒烟(direct endpoint)。
2. **钱链路 9 例真库测试全绿**(并发 Promise.all，断言恰好一个成功、其余被幂等/锁挡)——上线前必过。
3. 端到端：注册→送 0.14→生图(202→2s 轮询→succeeded 扣 0.07)→失败未扣→兑换 +N「积分到账」→后台调积分/封禁/看板→cron 过期/清理/对账。
4. assert-no-secrets-in-bundle 通过 + CI 全绿。
5. GB-hour 成本对账毛利>0（铁律②）。

## 执行节奏
- `main` 上开 `phase2` 工作分支。
- 严格 ①→⑦ 顺序；**钱链路(③) + 真库测试(⑦ money)是命门，测试不过不上线**。
- 离线先行：① schema/迁移/seed、④ 契约/relay/failure（不需密钥）；接真服务待 §0 密钥齐。
