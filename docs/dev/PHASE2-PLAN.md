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
| **Neon Postgres**（AWS 美东，与 Netlify 同区） | `DATABASE_URL`(pooled) · `DATABASE_URL_UNPOOLED`(direct) · 每 PR 一个 test branch | ①起 | 🟡 direct 串已配（PG18.4，迁移+seed 已跑通）；pooled 串(带 -pooler)+每 PR test branch 待补 |
| **对象存储（S3 兼容）= Supabase Storage**（公有桶，免自定义域/免绑卡；代码厂商中立 `STORAGE_*`，换 R2/B2/S3 只改值。原选型 Cloudflare R2 因需自定义域+绑卡，站长 2026-06-21 改 Supabase Storage） | `STORAGE_S3_ENDPOINT`/`STORAGE_S3_REGION`/`STORAGE_S3_ACCESS_KEY_ID`/`STORAGE_S3_SECRET_ACCESS_KEY`/`STORAGE_BUCKET`/`STORAGE_PUBLIC_BASE_URL` | ①/④ | ✅ 已开通并验证（Supabase project `exexcwt…`，public 桶 `images`，region ap-northeast-2；6 变量存 `.env`；`scripts/storage-smoke.ts` 往返 PASS） |
| **Better Auth** | `BETTER_AUTH_SECRET`(可生成) · `BETTER_AUTH_URL` | ② | ⬜ |
| **中转**（v1 已有，确认） | `RELAY_API_KEY` · `RELAY_BASE_URL`(+可选 `RELAY_BASE_URL_BACKUP`) · `DAILY_RELAY_BUDGET_CALLS/_MS` | ④ | ⬜ 确认 |
| 可观测/告警（可后补） | `SENTRY_DSN` · `ADMIN_ALERT_WEBHOOK` | ⑦ | ⬜ |
| 第三方店铺购买 URL | 套餐 `redirect_url` | ⑥（可占位） | ⬜ |

> **可立即离线开工（不需密钥）**：① 的 Drizzle schema/迁移/seed、④ 的契约（`src/contracts/*`）/relay 封装/失败归一。建议站长并行开通 Neon + R2。
> **隔离**：在 `main` 上新建 `phase2` 工作分支推进。

---

## §1 地基（Foundation）— 连接 / 表 / 存储（无钱逻辑）
> **状态（2026-06-21）**：离线代码全部完成并通过 tsc 0 / vitest 45 / build / 7 维多代理对抗校验（schema-ddl/money-redlines/failure 零发现；5 条 minor 已修）。**接真已对真 Neon(PG18.4) 跑通：迁移应用 + 13/13 表 + 7/7 关键索引 WHERE 谓词在库校验 + FOR UPDATE 交互式事务冒烟 + seed(2 套餐/8 config，幂等) ✅**（`scripts/db-smoke.ts`/`db-verify.ts`，`node --env-file=.env --import tsx …`）。**putToR2 往返已对真 Supabase Storage 验证（`scripts/storage-smoke.ts`：上传→public_url fetch 200 image/png→删除，PASS）→ ① 地基全部完成。**
- [x] 装依赖：drizzle-orm · drizzle-kit · @neondatabase/serverless · ws · @aws-sdk/client-s3 · zod · drizzle-zod · @types/ws（+tsx）（`package.json`）
- [x] **DB 双连接** `src/db/db.server.ts`：`getPool()`(Pool/WS over `DATABASE_URL_UNPOOLED`，`neonConfig.webSocketConstructor=ws`) 给事务；`getSql()=neon(DATABASE_URL)` HTTP 给看板/单语句。开-用-关单 handler 内，不跨请求复用
- [x] **Schema** `src/db/schema.ts`：13 张业务表（users/credit_accounts/credit_lots/credit_ledger/packages/redeem_codes/conversations/generations/images/audit_log/notifications/events/app_config），金额列 `bigint`(`_mp`/`_cash`)，全二级索引 + **5 个部分唯一索引**(uq_debit/uq_refund/uq_grant_signup/uq_credit_code/uq_expire_lot，均 ON `credit_ledger(ref_id)` + WHERE 谓词) + `uq_notif_dedupe`
- [x] **迁移** `drizzle.config.ts` + `drizzle/0000_phase2_foundation.sql`：`drizzle-kit generate` 后**已人工核对** 5 个 partial-unique 的 WHERE 谓词逐条正确（含 uq_grant_signup 复合 `entry_type='grant' AND ref_type='signup'`）；手工补 `CREATE EXTENSION pgcrypto`
- [x] **种子** `src/db/seed.ts`：admin(SEED_ADMIN_EMAIL 提权翻 role) · packages(¥9.9→990/10000mp，¥29.9→2990/32000mp，固定 UUID 幂等) · app_config(70/140/30/7/60/2 + 预算阈值；非数值 env 当场报错)
- [x] **对象存储（后端 = Supabase Storage，S3 兼容；接真已验）** `src/server/r2.server.ts`：`putToR2(userId,generationId,relayImage)` · `buildStorageKey`={uid}/{yyyy}/{mm}/{genId}-{rand}.png(crypto rand 防猜) · `publicUrl()` · `retentionExpiry(user,cfg)` · 删除助手(单/批，批量自动分片 ≤1000 + 返回失败 key)；S3Client 厂商中立 `STORAGE_*`（显式 endpoint + `forcePathStyle:true`），`CacheControl: immutable`。**真 Supabase 验：`scripts/storage-smoke.ts` 上传→public_url 200 image/png→删除 PASS**（原选型 R2 因需自定义域+绑卡改 Supabase，换回只改 env）

🔴 **红线**：金额整数（绝不 float/NUMERIC）；`users.id` 无 DB default（鉴权 hook 写 Better Auth UUID）；两种连接不可混用（防双花读改写必须 Pool/WS+FOR UPDATE）；storage_key 的 rand 段是唯一软隔离，前端只读 public_url、绝不拼 key/碰中转临时 URL。
✅ **验证**：tsc/vitest/build 绿 + 客户端 bundle 0 密钥泄露 + 迁移 WHERE 谓词人工核对通过（离线已过）。**真 Neon(PG18.4)：迁移已应用 + 13/13 表 + 7/7 关键索引 WHERE 谓词在库校验 + FOR UPDATE 交互式事务冒烟 + seed(幂等) 全过 ✅。** **putToR2 往返已验：对真 Supabase Storage `scripts/storage-smoke.ts` 上传→public_url fetch 200 image/png→删除 PASS ✅。**

## §2 鉴权（Better Auth）
> **状态（2026-06-21）**：核心完成并对真 Neon 验证（注册→送 140mp→幂等、user.id 原生 uuid、4/4 表）；tsc 0·vitest 45·build·客户端 0 泄露 + 6 维多代理对抗校验（auth/grant/hooks/guards/红线 零发现，1 条 doc-drift minor 已修）。**封禁/改密 route 归 ⑥（admin 端点）**。
- [x] 钉版装包：better-auth@1.6.20 + admin 插件（精确钉版、不启 multi-session）+ bcryptjs@3.0.3 + @better-auth/cli（dev）
- [x] **单实例** `src/lib/auth.ts`：email+password(min6/**password.hash 内 72 字节断言**/autoSignIn/不验邮箱) · session(7d/updateAge24h/cookieCache300s) · `advanced.database.generateId:'uuid'`(字面量，已验 native uuid 列) · admin 插件 · databaseHooks
- [x] `@better-auth/cli migrate` 生成 user/session/account/verification（同库，**不写进 schema.ts**）；已验 user.id=uuid
- [x] catch-all handler `app/routes/api.auth.$.ts`（RR 资源路由 loader+action=`auth.handler(request)`）+ routes.ts 注册 `api/auth/*`
- [x] 密码契约 `src/contracts/auth.ts`：Zod `z.email` + `passwordField`(min6 + `TextEncoder().encode(p).length<=72`，复用 account.ts)
- [x] 守卫 `src/lib/guard.ts`：`requireUser`(cookieCache) · `requireUserStrict`(disableCookieCache + 查业务 users role/banned/并发，ban 双源 fail-closed) · `requireAdmin`
- [x] 注册发放钩子 `src/lib/auth-hooks.ts`：`onUserRegistered`(awaits grant→失败则注册失败) · `onSessionCreated`(孤儿惰性补发，email 取自 `"user"` 表)
- [ ] 封禁/改密 route（→ 归 ⑥ admin-users-*）：走 Better Auth API(自动吊销会话) + 同步 audit

🔴 **红线**：`generateId:'uuid'` 必须字面量；**bcrypt 72 字节断言在 `password.hash` 内**；敏感/钱/封禁路径必须 disableCookieCache 每请求查 DB；会话存废只走 Better Auth API；signup grant 靠 `uq_grant_signup` 幂等、钩子失败→注册失败。
> ⚠️ **待 ⑦**：`scripts/assert-no-secrets-in-bundle.ts` 尚未建（密钥进 bundle 的 CI 兜底）；`auth.ts`/`guard.ts` 用 `★server-only` 注释约定（非 `.server.ts` 后缀，依 PHASE2-PLAN 命名），当前 build 实测 0 泄露安全，CI 断言留 ⑦。

## §3 钱链路（命门 — 最不容错）
> 全部走 `src/server/tx.server.ts`(Pool/WS+FOR UPDATE)；SQL 照 03-money 逐条落 TS。
> **状态（2026-06-21）：③ 全部完成并对真 Neon(PG18.4) 验证。** 8 个文件落地；**28 例真库测试全绿**（`tests/money/`，10 文件，`Promise.all` 真并发/重入，`npm run test:money`）；tsc 0 · vitest 45(单测) · build。**多代理对抗审查**（7 维并行精读 + 逐条证伪，10 agents）：0 blocker / 1 confirmed major 已修——adjust 减额 FIFO 漏过滤已过期批次（会被对账反转），补 `AND (expires_at IS NULL OR expires_at>now())` + 同步修 09 §10.3 规格示例 + 加端到端回归。
- [x] `src/server/tx.server.ts`：`tx(async c=>…)` connect→BEGIN→COMMIT/ROLLBACK→release→end（+ `config.server.ts` readConfigInt/getConfigInt）。**②鉴权 grant 已用并对真库验**
- [x] **预算熔断（铁律①）** `src/server/budget.server.ts`：软闸 `isDailyBudgetExhausted(c)` + **硬上限** `incCallIfUnderCap()`=`UPDATE…WHERE calls<阈值 RETURNING`(原子防 TOCTOU) + `incMs`。阈值取 app_config 回退 env；date-in-key Asia/Shanghai。**真库验：cap=5 时 12 并发恰 5 成功**
- [x] **入队三闸** `src/server/generation/enqueue.ts`：并发(409)/余额(402，**只判不扣**)/软预算(429) + 建会话 + `INSERT generations(queued)` **同一事务**（锁 credit_accounts 行 FOR UPDATE 串行化）→ 返回 {generationId,conversationId}。**真库验：402/409/429 三闸**
- [x] **抢占状态机（铁律③）** `src/server/money/preempt.server.ts`：`claim`=`UPDATE…WHERE status='queued' RETURNING`(HTTP 单语句原子，affected=0 即退) · `markRunning` 写 started_at。**真库验：两实例并发恰 1 抢到**
- [x] **扣费（核心）** `src/server/money/debit.server.ts`：putToR2 在**事务外**(结果作入参)；事务内 **⓪双守卫**(⓪a `SELECT status FOR UPDATE` 断言 running · ⓪b 探 uq_debit 已存在→幂等 no-op) → ① FIFO 锁 lots → ② 扣 `charged`(实扣量、不出负、零头记 credit_shortfall) → ③ `INSERT images ON CONFLICT DO NOTHING` → ④ 物化余额 `-charged` RETURNING → ⑤ ledger debit(uq_debit ON CONFLICT) → ⑥ succeeded + `duration_ms=(EXTRACT(EPOCH…)*1000)::int` + image_succeeded。charged===0 跳过 ④⑤(amount_mp CHECK>0)。**真库验：成功扣/重入幂等(⓪a+⓪b)/真并发/FIFO跨批/失败守卫**
- [x] 兑换 `src/server/money/redeem.server.ts`：`UPDATE…WHERE status='active' RETURNING`→0 行再查状态分 404/410；同事务入账 lots+ledger(uq_credit_code)+余额；首兑升级 has_paid + 旧图顺延 60 天；失败限流 5/10min。**真库验：并发双击只入账 1 次/错误码/永久批次/首兑顺延**
- [x] 注册发放 `src/server/money/grant.server.ts`：单事务 users+account+signup lot+ledger(uq_grant_signup)+events，GRANT_MP/有效期读 app_config。**幂等强化**：以 credit_accounts(user_id PK) INSERT…ON CONFLICT DO NOTHING RETURNING 作串行化闸，杜绝重入/并发重复 lot/events；修真库 42P08（user_id uuid / ref_id text 分参）。**真库验：注册→140mp→幂等(顺序+并发)**
- [x] 过期 `src/server/money/expire.server.ts`：每日 FIFO 清零到期 lot(永久 lot 跳过)，uq_expire_lot 幂等。**真库验：清零+同步余额+重跑幂等**
- [x] 调账 `src/server/money/adjust.server.ts`：admin ±，**同事务动 credit_lots + 物化余额 + ledger(adjust) + audit**，记真实 moved 量，不出负；减额 FIFO **只扣未过期批次**(防对账反转，对抗审查修)。**真库验：增/减/不出负/避开过期批经 expire+reconcile 意图存活**
- [x] 对账 `src/server/money/reconcile.server.ts`：`SUM(lots.remaining 未过期)`(::text+BigInt) vs 物化余额，**先告警再以 lots 为准修正** + balance_reconciled。**真库验：制造 drift→检出+修正收敛**

🔴 **红线**：⓪双守卫是扣费事务**第一步**(同时挡重入重复扣 & 超时翻 failed 后仍扣)；**成功才扣**；ledger/lots/物化余额三者用同一 charged、balance_after 取 RETURNING；`duration_ms` 用 `EXTRACT(EPOCH…)*1000`（绝不 `EXTRACT(MILLISECONDS…)`）；预算硬上限原子条件自增；adjust 必动 lots；5 个 partial-unique 迁移后人工核对 WHERE。

## §4 生图管线 + API 契约
> **状态（2026-06-22）：后端管线全部完成并对真验证。** 3 端点(v2 Request) + `runGenerationJob` 编排 + 触发 + 清死代码落地；`pipeline.test.ts` 5 例真库（注入 relay/putToR2 桩）+ 中转真生图端到端冒烟（`scripts/relay-smoke.ts`，47.5s 出图→Supabase→public_url 200）。**多代理对抗审查（3 维并行+逐条证伪）：0 finding。** tsc 0·vitest 37(单测,删 v1 -8)·test:money 33·build。**余 `rateLimit.ts` 收口 + 前端接真并入 ⑤ 一起做（需登录态，与 auth 页接真同步）。**
- [x] 契约 `src/contracts/{error,generate,redeem,me,notification,conversation,image,package,inspiration,account}.ts` + `index.ts` barrel：统一错误信封 + `GenerateStatusResponse` 判别联合 + SIZES + 6 值 ERROR_CODES + `REDEEM_ALPHABET/REDEEM_CODE_RE`；单笔 number、SUM(expiringSoon.mp) string codec；`package.ts` drizzle-zod 派生；`generate.ts` 雏形升级为 Zod（向后兼容，消费端全 `import type`）。**离线先行（§4 其余 generate*/限流/前端接真待 ④ 推进）**
- [x] **relay 封装（铁律④）** `src/server/relay.ts`：Key 只从 `process.env.RELAY_API_KEY`；主/备 Base（DB 不可达回退 env）；AbortController 4.5min 软超时→provider_timeout；F-429(HTTP200+error body)守卫；**AbortError 不重试**；复用 v1 `imageGeneration.ts` build/parse + `redaction.ts`；`toRelayImage` 桥接 ParsedImage→putToR2 入参(任意 base64 data URL 提 b64_json)
- [x] 失败归一 `src/server/generation/failure.ts`：先脱敏 → 6 值枚举（precedence: timeout→unreachable→quota→content→5xx→unknown），message≤500
- [x] 提交(同步) `netlify/functions/generate.ts`（v2 Request）：requireUserStrict→`GenerateRequest.parse`→enqueue→`triggerBackground`(fire-and-forget，body 仅 `{generationId}`)→202；enqueue 抛的 Response(402/409/429/404) 经 `e instanceof Response` 原样返回；**绝不 await relay**
- [x] 后台(15min) `netlify/functions/generate-background.ts`：`-background` 后缀；body 仅 `{generationId}`→`runGenerationJob`（`src/server/generation/process.ts`：claim→running→预算硬闸(incCallIfUnderCap)→callRelay→putToR2(事务外)→chargeOnSuccess；catch→归一 failed；finally→incMs；callRelay/putToR2 可注入测试桩）
- [x] 状态 `netlify/functions/generate-status.ts`（v2）：requireUser owner-scoped(`WHERE id AND user_id` 否则 404)→判别联合三态；失败也 200；只回 R2 public_url + 触发 `src/server/generation/trigger.ts`
- [x] 清死代码：删 `src/server/{jobStore,asyncImageJob,imageProxy}.ts` + 两测试（v1 Blobs DB-as-queue 前身）；生成链路无 apiKey（`proxyGeneration` 留前端接真时清/复用）；`netlify.toml` 补 `/api/generate-status` 重写
- [x] 限流 `src/server/rateLimit.ts`：DB 计数窗口(redeem 5/10min、sign-in 10/10min、sign-up 5/hr，只计失败)。events `type='rate_fail'`+kind 维度(IP/subject)；redeem.server 限流收口于此（保留 checkRedeemRateLimit/recordRedeemFailure 签名）；sign-in/up 在 `api.auth.$.ts` action 内包裹（clone 读邮箱、>=400 才记失败）。**reads-smoke 验：5 次失败→命中**
- [x] 前端接真：`src/hooks/useGenerationStatus.ts` queryFn→`GET /api/generate-status`(2s 轮询/终态停/5min 兜底)；`useGeneration` submit→`POST /api/generate`(202 含 conversationId)→invalidate 详情/侧栏+首次"/"提交 navigate(/c/:id)；**轮询由「会话详情里的进行中轮」驱动**（修：跨 "/"→"/c/:id" unmount 不丢轮询）+终态 invalidate 余额/面板/资产+5min 强制释放 UI

🔴 **红线**：同步函数不 await relay；`-background` 后缀=真后台；claim 铁律③；预算硬闸在 relay 前；putToR2 在扣费事务外；失败不进扣费事务；回前端脱敏、只给 R2 public_url；生成不可取消。

## §5 前端业务页接真（换 mock 不改结构）
> **状态（2026-06-22）：完成并对真 Neon 端到端验。** A) 读端点全建为 RR 资源路由(`app/routes/api.*.ts` 11 个，server-only 同 `api.auth.$`，调 `src/server/reads.server.ts`)；写走 action(redeem 调既有 `redeemCode`+限流、images save/delete owner-scoped)。B) auth 页接真(Better Auth client `src/lib/auth-client.ts`，login/register/改密/登出+`?next=`回跳+错误映射)。C) 生成接真(`mocks/api`→真 fetch，轮询由会话详情进行中轮驱动)。D) 全页 loader 换 mock(SSR initialData→TanStack Query 同 key)；**删 `src/mocks/*` + `proxyGeneration.*`**，`_app` 父 loader 守卫(redirect)。E) 资产库批量管理做实。F) `rateLimit.ts`(并入 §4)。**验证**：tsc 0·test:run 30(删 mock 测试 -7)·test:money 33·build 0·客户端 0 密钥泄露·`scripts/reads-smoke.ts` 25 检查全绿(注册→送 140→兑换→生成→详情/资产回流→存入→删除→限流，对真 Neon)·多代理对抗审查。**契约小增**：`GenerateAccepted+conversationId`、`ConversationGeneration.image+{id,savedToLibrary}`、`MeResponse.user+createdAt`、`InspirationItem cover→string+width/height`(均向后兼容)。
- [x] 充值/资产库/本次面板/历史会话 → loader(SSR) + REST(写) 接真；删 `src/mocks/*`，MockProvider 改真数据源（`_app` 父 loader = requireUserPage + loadMe + loadConversations）
- [x] 余额(`["me","balance"]`)/job/列表统一 TanStack Query(loader 作 initialData，`src/hooks/queries.ts`)；成功后 invalidate 余额/面板/资产
- [x] 并发提示(409) · 积分过期黄点(`/api/me` expiringSoon string codec) · 通知铃铛(`/api/notifications`+`/read`，`NotificationBell`) 接真
- [x] 资产库**批量管理**(批量管理切换 + 单击/Shift 连选 + 吸底操作条 + store-mode zip(`src/lib/zip.ts`，失败退化逐张) + 删除带 `ConfirmDialog` 确认，§24.9)——做实（真·drag 框选矩形留待增强）

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
- [x] **钱链路真库测试**（命门，随 ③ 完成）：`tests/money/*.test.ts`（10 文件 **28 例** ≥ 9 例底线）+ `vitest.money.config.ts`(node env，从 `.env` 注入 Neon 串) + `npm run test:money`。对真 Neon `Promise.all` 并发/重入：双击兑换/重入扣费(⓪a+⓪b)/真并发扣费/抢占/FIFO 跨批/过期幂等/注册发放(顺序+并发)/入队三闸(402/409/429)/超时重扫(EXTRACT-EPOCH)/对账/预算硬上限 TOCTOU/调账(增减/不出负/防对账反转)。**全绿**。⚠️ **待 ⑦/CI**：每 PR 一条 Neon test branch 自动化（`tests/setup/neon-branch.ts`，当前对共享 direct 串跑）
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
