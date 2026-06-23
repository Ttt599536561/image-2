# 8 · API 契约

> 本章定**契约**：端点清单、语义化状态码、统一错误信封、Zod schema。规则真相源：规格 [§5](../redesign-requirements.md)（五态）/[§6](../redesign-requirements.md)（计费）/[§7](../redesign-requirements.md)（兑换）/[§10](../redesign-requirements.md)–[§13](../redesign-requirements.md)（历史/面板/资产库/灵感库）/[§24](../redesign-requirements.md)（交互默认值）。
> **前端怎么消费**见 [08-frontend.md §9.3](08-frontend.md)；**后台 admin API** 见 [09-admin.md §10.1](09-admin.md)；**事务实现**见 [03-money.md](03-money.md)。
> RR7 下读路径多走 **loader**（[08-frontend.md §9.2](08-frontend.md)），写/动作走**手写 REST `netlify/functions/*` 或 RR7 action**。本章给两者统一的**输入/输出/状态码/校验**约定。

## 8.1 约定

| 项 | 约定 |
|---|---|
| 协议 | REST + JSON（`Content-Type: application/json`）；二进制（图）走 R2 `public_url`，不经本站 API |
| 鉴权 | **Better Auth cookie 会话**（HttpOnly）；无 Bearer/无 API Key 给前端。敏感路径每请求查 DB（不吃 cookieCache，[05-auth.md §6.3](05-auth.md)） |
| 时间 | 一律 ISO-8601 UTC 字符串（`2026-06-21T08:30:00Z`），展示层本地化 |
| 金额 | 跨 JSON 用**整数 mp / 分**，字段带 `_mp` / `_cash` 后缀；前端展示才 `/1000`、`/100`（[02-database.md §3.6](02-database.md)） |
| 分页 | `?page=1&pageSize=N`，响应 `{ items, page, pageSize, total }`；列表均默认倒序 |
| 错误信封 | 所有非 2xx 返回**统一信封**（下方），前端按 `error.code` 分支文案 |
| 脱敏 | **所有回前端响应先过脱敏**（复用 [redaction.ts](../../src/lib/redaction.ts)）；中转原始响应、报错串里的 Key/连接串一律替换（[00-overview.md §1.4](00-overview.md)） |
| 契约源 | 请求/响应 Zod schema 放 `src/contracts`，**前后端单一真相源**（§8.5） |

**统一错误信封**（成功无此结构，直接返回数据对象）：

```jsonc
{ "error": { "code": "INSUFFICIENT_CREDITS", "message": "积分不足，去充值", "details": {} } }
```

- `code`：稳定大写枚举（前端据此分支，**不解析 message**）。
- `message`：面向用户的中文文案（已脱敏，可直接 toast/卡片展示）。
- `details`：可选，结构化补充（如限流 `retryAfterSec`、并发 `limit/current`）。

```ts
// src/contracts/error.ts —— 错误信封与统一抛出器
export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export function httpError(status: number, code: string, message: string, details?: object) {
  return Response.json({ error: { code, message, details } }, { status });
}
```

## 8.2 状态码语义

> 只用下表这些码，含义固定；前端按 `状态码 + error.code` 双重判定（同码可多场景，靠 `error.code` 细分）。

| 码 | 语义 | 典型场景（本项目） | error.code 例 |
|---|---|---|---|
| **200** | OK | 读列表/详情、兑换成功、改密成功、删除成功 | — |
| **202** | Accepted（已入队） | `POST /api/generate` 通过双闸 → 建 `generations(queued)` 并真后台触发 | — |
| **400** | 参数/格式错误 | prompt 空、size 非枚举、兑换码格式不符、分页越界 | `INVALID_PARAM` / `BAD_CODE_FORMAT` |
| **401** | 未登录 | 无有效会话 cookie 访问需登录端点 | `UNAUTHENTICATED` |
| **402** | 需付费（积分不足） | 入队前余额 < 70mp（不入队、不扣费，[03-money.md §4.9](03-money.md)） | `INSUFFICIENT_CREDITS` |
| **403** | 已登录但无权 | 账号被封禁；非 admin 访问 `/api/admin/*` | `BANNED` / `FORBIDDEN` |
| **404** | 资源不存在 | 会话/生成/图片 id 不存在或不属本人；兑换码不存在 | `NOT_FOUND` / `CODE_NOT_FOUND` |
| **409** | 冲突 | **超出并发数量**；注册邮箱已存在 | `CONCURRENCY_LIMIT` / `EMAIL_TAKEN` |
| **410** | Gone（资源已失效） | 兑换码**已被使用** / **已作废** | `CODE_USED` / `CODE_DISABLED` |
| **429** | 限流 / 熔断 | 兑换/登录/注册超频；**单日预算熔断**拦生成入口（[04-generation-pipeline.md §5.6](04-generation-pipeline.md)） | `RATE_LIMITED` / `BUDGET_EXHAUSTED` |
| **500** | 服务端错误 | DB/中转/R2 不可控异常（**已脱敏**后返回通用文案） | `INTERNAL` |

> 失败的生成本身**不是 HTTP 错误**：`generate-status` 用 **200** 返回 `status:'failed' + errorCode/error/httpStatus`（业务态在响应体里，不用 HTTP 码表达，见 §8.3）。

## 8.3 端点清单

> 「读」标 **loader** 的走 RR7 server loader（SSR 直连 DB，[08-frontend.md §9.2](08-frontend.md)）；标 **REST** 的是 `netlify/functions/*` 或 RR7 action。所有端点默认需登录（除 Better Auth 注册/登录本身）。请求/响应 schema 名指向 §8.5 的 `src/contracts/*`。

### 会话 / 鉴权

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| POST | `/api/auth/sign-up` | `{email,password}` | `{user}` + Set-Cookie | 200/400/409/429 | Better Auth |
| POST | `/api/auth/sign-in` | `{email,password}` | `{user}` + Set-Cookie | 200/400/401/429 | Better Auth |
| POST | `/api/auth/sign-out` | — | `{ok:true}` | 200 | Better Auth |
| GET | `/api/me` | — | `MeResponse`（user + `balance_mp` + `max_concurrency` + `has_paid` + `expiringSoon`） | 200/401 | loader |

> 注册成功**原子发放 0.14**（[03-money.md §4.4](03-money.md)）；邮箱已注册 → **409 `EMAIL_TAKEN`** 文案"该邮箱已注册，请直接登录"（[§24-1](../redesign-requirements.md)）。封禁账号在 `/api/me` 与任何受保护端点返回 **403 `BANNED`**（[05-auth.md §6.5](05-auth.md)）。
>
> `MeResponse.expiringSoon`（积分过期**实时**提示数据源，非存储通知，[08-frontend.md §9.7](08-frontend.md) 顶部积分药丸黄点 + tooltip 消费）：`{ mp:string, nearestExpiresAt:string|null }`——`mp` 为「3 天内即将过期的剩余毫积分之和」（走 string codec，§8.5）、`nearestExpiresAt` 为最近一笔过期时间（无则 `null`）。来源 SQL（与 lot 模型对齐，[02-database.md §3.4](02-database.md)）：
> ```sql
> SELECT COALESCE(SUM(remaining_mp),0)::text AS mp, MIN(expires_at) AS nearest
> FROM credit_lots
> WHERE user_id = $1 AND remaining_mp > 0
>   AND expires_at IS NOT NULL AND expires_at < now() + interval '3 days';
> ```

### 生成（核心）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| POST | `/api/uploads` | **multipart** `file`（图生图参考图） | `{ inputImageKey }` | 200/400/401/413/429 | REST |
| POST | `/api/generate` | `GenerateRequest` | `{ generationId, status:'queued' }` | **202**/400/401/402/403/409/429 | REST |
| GET | `/api/generate-status?id=` | `?id=uuid` | `GenerateStatusResponse` | 200/400/401/404 | REST（短轮询） |

`GenerateRequest`（[§5.1](../redesign-requirements.md)）：`{ prompt, size, quality?, background?, conversationId?, inputImageKey? }`。`model` 不收（**固定 `gpt-image-2`**）、`n` 不收（固定 1）、`moderation` 不收（固定 `low`）、**任何 Key 字段不收**（删 v1 `apiKey`，[00-overview.md §1.4](00-overview.md)）。`conversationId` 缺省 → 服务端新建会话（标题取 prompt 前 20 字，[§10](../redesign-requirements.md)）。`inputImageKey?`=**图生图参考图**（来自 `POST /api/uploads` 返回，见下）；入队时**owner-scope 校验前缀** `uploads/<me>/`（非本人前缀 → 拒），落 `generations.input_image_key`（迁移 `0003`），有则管线走中转 `/images/edits`、无则常规 `/images/generations`（[04-generation-pipeline.md](04-generation-pipeline.md)）。

`POST /api/generate` 在**入队前三重闸**（并发 / 余额 / 预算，[03-money.md §4.9](03-money.md)）：
- 并发满 → **409 `CONCURRENCY_LIMIT`**，`details:{limit,current}`，文案"超出并发数量"。
- 余额 < 70mp → **402 `INSUFFICIENT_CREDITS`**，文案"积分不足，去充值"。
- 当日预算熔断 → **429 `BUDGET_EXHAUSTED`**，文案"今日额度已满，请稍后"。
- 通过 → **202** + `generationId`，前端起短轮询（[08-frontend.md §9.4](08-frontend.md)）。

`POST /api/uploads`（**图生图参考图上传**，`requireUserStrict`）：收 **multipart** 单 `file`，**不信声明 `Content-Type`**——读字节后**魔数嗅探** `sniffImageMime`（仅放行真图片 magic bytes），非图 → **400**；超 **4MB**（留 Netlify SSR ~6MB body 余量）→ **413**；**每用户 40 次 / 10 分钟**限流（[§8.6](#86-限流)）→ **429 `RATE_LIMITED`**。通过则存对象键 `uploads/<userId>/…`（owner-scope 前缀），返回 `{ inputImageKey }` 供 `GenerateRequest.inputImageKey` 携带入队。参考图**用后即弃**——不入资产库、不绑 60 天保留，由孤儿 cron 回收未被引用的 `uploads/*`（[06-storage.md](06-storage.md) / [10-ops-test.md](10-ops-test.md)）。

`GenerateStatusResponse`（**始终 200**，业务态在体内，按 `status` 的**判别联合**，三态字段各不相同，与 [04-generation-pipeline.md §5.4](04-generation-pipeline.md) 逐字段一致，[§5](../redesign-requirements.md) 五态）：

```jsonc
// 进行中（queued|claimed|running）—— 不含 creditsChargedMp
{ "status":"running", "startedAt":"…", "elapsedMs": 12000 }
// succeeded —— 只给 R2 稳定 public_url，绝不给中转临时 URL（[01 §2.1]）
{ "status":"succeeded",
  "image": { "publicUrl":"https://img.example.com/…", "width":1024, "height":1024 },
  "creditsChargedMp": 70, "durationMs": 38000 }
// failed —— 归一化 errorCode + 脱敏 error + 中转 httpStatus（可空），且成功才扣 → 未扣（[03 §4.6]）
{ "status":"failed",
  "errorCode":"provider_timeout", "error":"504 中转网关超时", "httpStatus": 504 }
```

> 进行中态只有 `status` + `startedAt?` + `elapsedMs?`，**不含** `creditsChargedMp`（未结算）。失败态 `errorCode` 为归一化枚举（[04-generation-pipeline.md §5.8](04-generation-pipeline.md)：insufficient_quota｜relay_5xx｜provider_timeout｜content_rejected｜relay_unreachable｜unknown）、`error` 为脱敏可读串（可含状态码原文）、`httpStatus` 为中转 HTTP 状态码（无则 `null`）。成功态 `durationMs` 由扣费事务库内算出（[03-money.md §4.3](03-money.md)）；失败未扣无需在响应注明退款（成功才扣，[§5.3](../redesign-requirements.md)）。

### 会话（ChatGPT 式历史，[§10](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/conversations?page=&pageSize=20` | 分页 | `{ items:[{id,title,updatedAt}], page,pageSize,total }` | 200/401 | loader |
| GET | `/api/conversations/:id` | — | 会话 + 其 `generations`（按时间正序，含图/态） | 200/401/404 | loader |
| POST | `/api/conversations` | `{}`（或随首条 prompt 隐式建） | `{ id }` | 200/401 | REST |
| PATCH | `/api/conversations/:id` | `{ title }` | `{ id, title }` | 200/400/401/404 | REST |

> 「最近」列表按 `updated_at` 倒序、每页 20（[§24-2](../redesign-requirements.md)）。**重新生成**不调专门端点——前端回填 prompt/参数后再发 `POST /api/generate`（[§5.2](../redesign-requirements.md)）。

### 本次面板 + 生成记录（同份数据不同查询，[§11](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/generations?conversationId=&status=` | conversationId 必填 | `{ items:[gen+image] }` | 200/400/401 | loader |

> 「本次对话图片面板」= `generations WHERE conversation_id`（[§11](../redesign-requirements.md)），默认 `status=succeeded`、倒序（[§24-7](../redesign-requirements.md)）。**全站生成记录列表是后台能力**，见 [09-admin.md §10.5](09-admin.md)，不在用户面。

### 资产库（[§12](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/images?range=&from=&to=&page=&pageSize=50` | 日期筛选 + 分页 | `ImagesResponse`（按日期分组元数据 + items） | 200/400/401 | loader |
| POST | `/api/images/save` | `{ generationId }` | `{ id, savedToLibrary:true }` | 200/401/404 | REST |
| DELETE | `/api/images` | `{ ids: uuid[] }`（批量） | `{ deleted: number }` | 200/400/401 | REST |

> 仅本人图（`user_id=session.userId`）；`range ∈ {all,today,7d,30d,custom}`，custom 配 `from/to`（[§24-8](../redesign-requirements.md)）；分组「今天/昨天/具体日期」由前端按 `createdAt` 渲染（[§12](../redesign-requirements.md)）。删除**不可恢复**（同时异步删 R2 对象，[06-storage.md §7.5](06-storage.md)），前端弹确认（[§24-9](../redesign-requirements.md)）。「存入资产库」= 置 `saved_to_library=true`（[§5.2](../redesign-requirements.md)/[§24-6](../redesign-requirements.md)），已存按钮置灰。

### 灵感库（只读，站长后台维护，[§13](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/inspirations?category=&q=` | 品类筛选 + 关键词搜索（服务端 ILIKE，匹配 title/summary/prompt） | `{ items:[{id,cover,title,summary,prompt,category,width,height}], categories:[string] }` | 200 | loader |

> 仅返回**已上架**(`active=true`)卡；「用此提示词」纯前端回填 Composer（[§13](../redesign-requirements.md)/[§24-10](../redesign-requirements.md)），无独立端点。CRUD 是后台能力（[09-admin.md §10.4](09-admin.md)）。`InspirationItem` 含 `submitter:string|null`（用户投稿卡显「由 X 投稿」掩码昵称、站长自建为 `null` 不显署名，来源 `inspirations.submitter_name`）。
> **P3-S4**：`category`/`q` 下沉为 SQL（`likePattern` 转义 `\%_` + 参数化绑定防注入），**仅当表无 active 卡时**回退服务端种子（`EXISTS(active)` 判定，非「筛选后为空」误回）；`categories` = `DISTINCT category`（active、排除 NULL/''，独立于当前筛选）供前台动态品类 Tab（前端补「全部」首位）；`width/height` = 封面原始宽高（瀑布流原比例，可空）。

### 灵感库用户投稿与审核（UGC，[§13.1](../redesign-requirements.md)，详细设计见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| POST | `/api/inspiration-submissions` | `InspirationSubmitRequest`（`{imageId,title,prompt,category?,summary?}`） | `InspirationSubmitResponse`（`{id,status:'pending'}`） | 200/400/401/404/429 | REST |
| GET | `/api/inspiration-submissions` | — | `MySubmissionsResponse`（我的近 50 条投稿 + 状态/驳回原因） | 200/401 | REST |

> 用户在灵感库点「投稿」→ 从**自己的作品**选一张图 + 填标题/提示词/分类/简介 → 落 `inspiration_submissions(status='pending')` + 复制一份**永久副本**（与上架表 `inspirations` 分离，保证用户端 `loadInspirations(active=true)` 零改动、不泄露 pending/rejected）。**不扣积分**（`requireUserStrict`）。POST 入口**服务端取权威字段**（按 `imageId` 校 `images.user_id=$me` 取 key/url/宽高，**绝不信客户端**）、非本人图 → **404**；**待审上限 10**（`INSPIRATION_SUBMISSION_MAX_PENDING`）+ 限流 **10 次 / 10 分钟**（`INSPIRATION_SUBMISSION_RATE_PER_WINDOW`，[§8.6](#86-限流)）超出 → **429**；**同图去重**（pending 或仍在架 approved）→ **400**；唯一索引 `uq_insp_sub_pending_src` 并发兜底 `23505` → **400**。表结构 / 副本键 `inspirations/submissions/<uid>/…` / 厂商中立复制见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)。

**后台审核**（`requireAdmin`，[09-admin.md §10.4](09-admin.md)）：

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/admin/inspiration-submissions?status=&page=&pageSize=` | 状态筛 + 分页 | `{ items, page, pageSize, total, pendingCount }`（队列 + 导航待审红点数） | 200/401/403 | REST |
| POST | `/api/admin/inspiration-submissions` | `SubmissionReviewAction`（判别联合 `op:'approve'|'reject'`） | `{ ok:true }` | 200/400/401/403/404 | REST |

> `op='approve'` → 事务内 `FOR UPDATE` 锁 + 校 `status='pending'` → 建 `inspirations` 上架卡（`cover_key`=投稿副本键、`submitter_name`=`publicHandleFromEmail` 掩码昵称、`submitted_by`=投稿人 id）→ 投稿置 `approved` + `published_inspiration_id` → 同事务 `writeAudit` + 站内通知 `inspiration_reviewed`（`dedupe_key=inspiration_reviewed:<subId>`）；`op='reject'` 同上置 `rejected` + `review_reason` + 审计 + 通知。审计动作 `approve_inspiration_submission` / `reject_inspiration_submission`（`targetType=inspiration_submission`）。**双守卫**（页 `requireAdminPage` + API `requireAdmin`）+ 通过编辑弹窗二次确认见 [09-admin.md §10.4](09-admin.md)。

### 充值 / 兑换（[§7](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/packages` | — | `{ items:[{id,title,description,priceCash,creditsMp,validDays,redirectUrl}] }` | 200 | loader |
| POST | `/api/redeem` | `{ code }` | `{ balanceMp, creditsValueMp }` | **200**/400/401/404/410/429 | REST |

> `packages` 仅 `active=true`、按 `sort`（[§7.1](../redesign-requirements.md)）；金额返回 `priceCash`(分)/`creditsMp`，前端展示 `¥9.9 / 10 积分`。兑换核销事务见 [03-money.md §4.7](03-money.md)，错误码见 §8.4。

### 账号面（[§24-1](../redesign-requirements.md)）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| POST | `/api/account/change-password` | `{ currentPassword, newPassword }` | `{ ok:true }` | 200/400/401 | REST（Better Auth） |
| GET | `/api/account/ledger?page=&pageSize=20` | 分页 | `{ items:[ledger行], total }` | 200/401 | loader |

> 改密走 Better Auth（密码 ≥6 位、字节限长在 `password.hash` 内强制断言防 bcrypt 72 字节截断，[05-auth.md §6.4](05-auth.md)）；改密后吊销其它会话（[05-auth.md §6.5](05-auth.md)）。**忘记密码本期占位**（提示联系站长，无端点，[§24-1](../redesign-requirements.md)）。

### 站内通知（[10-ops-test.md §11.7](10-ops-test.md) cron 预扫产出「图片到期前 1 天」+ 业务事件触发「灵感投稿审核」）

| 方法 | 路径 | 入参 | 响应 | 码 | 通道 |
|---|---|---|---|---|---|
| GET | `/api/notifications?unread=1` | `?unread=1`（列未读） | `{ items:[NotificationItem] }` | 200/401 | REST |
| POST | `/api/notifications/read` | `{ ids?: uuid[] }`（缺省全标） | `{ marked: number }` | 200/400/401 | REST |

> 仅本人通知（`user_id=session.userId`）。图片到期前 1 天由 cron 预扫 `images` 写 `notifications`（`type='image_expiring'`、`dedupe_key=image_expiring:<图id>`、`ON CONFLICT DO NOTHING` 防重发），表结构见 [02-database.md §3.2](02-database.md)；前端顶栏铃铛 + 未读红点见 [08-frontend.md §9.2](08-frontend.md)/[§9.6](08-frontend.md)，走 TanStack Query。**积分到期**走 `/api/me` 的 `expiringSoon` 实时字段（不入此表）。`POST /read` 缺 `ids` 即标记该用户全部未读为已读。
> **灵感投稿审核结果**：后台 approve/reject 在审核事务内写 `type='inspiration_reviewed'`（`payload:{status,title,reason?,inspirationId?}`、`dedupe_key=inspiration_reviewed:<subId>`）通知投稿人，铃铛 `Lightbulb` 图标 + 通过/驳回文案、点跳 `/inspiration`（[INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)）。

## 8.4 兑换错误码（与 [03-money.md §4.7](03-money.md) 对齐）

`POST /api/redeem` 流程：**blur 轻校验格式 → 提交才真核销**（[§24-4](../redesign-requirements.md)）。后端先限流 + 格式校验，再跑核销事务；`UPDATE…WHERE status='active' RETURNING` 命中 0 行时**再查当前 status** 区分 410 子因（[01-architecture.md §2.4](01-architecture.md)）。

| 情形 | HTTP | error.code | message |
|---|---|---|---|
| 格式不符（非 18 位 / 含排除字符 I/L/O/0/1，正则 `REDEEM_CODE_RE` 由 `REDEEM_ALPHABET` 派生） | 400 | `BAD_CODE_FORMAT` | 兑换码无效 |
| 码不存在 | 404 | `CODE_NOT_FOUND` | 兑换码无效 |
| 码已被使用（`status='redeemed'`） | 410 | `CODE_USED` | 该兑换码已被使用 |
| 码已作废（`status='disabled'`，含批次作废） | 410 | `CODE_DISABLED` | 兑换码已失效 |
| 尝试过多（**5 次失败 / 10 分钟**，按 IP+账号） | 429 | `RATE_LIMITED` | 尝试过多，请稍后再试 |
| 核销成功 | 200 | — | `{ balanceMp, creditsValueMp }`（前端 toast"积分到账"） |

> 404 与 400 共用文案"兑换码无效"——**对用户不区分"格式错"与"不存在"**（防枚举试探）；410 才明确告知已用/失效。限流计数只统计**失败**尝试。

## 8.5 Zod 契约（`src/contracts`）

**组织**：按域分文件，前后端 `import` 同一 schema 校验（请求体在函数入口 `.parse()`，前端提交前 `.parse()` 预校验、TanStack Query 解响应 `.parse()`）。

```
src/contracts/
  error.ts          # ErrorBody + httpError（§8.1）
  generate.ts       # GenerateRequest / GenerateStatusResponse
  conversation.ts   # ConversationListItem / ConversationDetail / RenameRequest
  image.ts          # ImagesResponse / SaveRequest / DeleteRequest
  redeem.ts         # RedeemRequest / RedeemResponse + REDEEM_ALPHABET + REDEEM_CODE_RE（字母表真相源，09 §10.2 共用）
  package.ts        # PackageItem（drizzle-zod 派生）
  inspiration.ts    # InspirationItem（含 submitter:string|null）
  inspirationSubmission.ts  # InspirationSubmitRequest/Response + MySubmissionItem/MySubmissionsResponse + 上限/限流常量（灵感库 UGC，§13.1）
  account.ts        # ChangePasswordRequest / LedgerItem
  me.ts             # MeResponse（含 expiringSoon）
  notification.ts   # NotificationItem / NotificationListResponse / MarkReadRequest
```

> `src/contracts/admin.ts` 另含审核动作 `ApproveSubmissionAction` / `RejectSubmissionAction` / `SubmissionReviewAction`（按 `op` 判别联合），供后台审核 API 入口 `.parse()`（[09-admin.md §10.4](09-admin.md)）。

**派生 + 手写并用**：响应/实体 schema 用 **drizzle-zod** 从 `src/db/schema.ts` 派生（保持与表对齐），**请求 schema 手写**（含业务约束）：

```ts
// src/contracts/generate.ts
import { z } from 'zod';
export const SIZES = ['auto','1024x1024','1024x1536','1536x1024','1088x1920','1920x1088'] as const;

export const GenerateRequest = z.object({
  prompt: z.string().min(1, 'prompt 不能为空').max(4000),
  size: z.enum(SIZES),
  quality: z.string().optional(),
  background: z.string().optional(),
  conversationId: z.uuid().optional(),
  inputImageKey: z.string().optional(),  // 图生图参考图键（来自 POST /api/uploads）；入队 owner-scope 校验前缀 uploads/<me>/
  // 显式禁收：model / n / moderation / apiKey —— 服务端固定，前端传了也忽略
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

// 按 status 的判别联合（与 04 §5.4 逐字段一致）：进行中无 creditsChargedMp，succeeded/failed 字段各异
export const ERROR_CODES = ['insufficient_quota','relay_5xx','provider_timeout','content_rejected','relay_unreachable','unknown'] as const;
export const GenerateStatusResponse = z.discriminatedUnion('status', [
  // 进行中：queued | claimed | running
  z.object({
    status: z.enum(['queued','claimed','running']),
    startedAt: z.string().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    status: z.literal('succeeded'),
    // width/height 可空：PNG 头解析失败时 images.width/height 为 NULL（[02 §3.2](02-database.md) / [06 §7.3](06-storage.md) readPngDims 可选），与 DB 列同口径
    image: z.object({ publicUrl: z.url(), width: z.number().int().nullable(), height: z.number().int().nullable() }),
    creditsChargedMp: z.number().int().nonnegative(),  // 单笔 ≤ 安全整数，number 即可
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal('failed'),
    errorCode: z.enum(ERROR_CODES),
    error: z.string(),                       // 脱敏可读串（可含状态码原文）
    httpStatus: z.number().int().nullable(), // 中转 HTTP 状态码，无则 null
  }),
]);
export type GenerateStatusResponse = z.infer<typeof GenerateStatusResponse>;
```

```ts
// src/contracts/redeem.ts —— 码格式正则前后端共用（[§24-4]）
// REDEEM_ALPHABET 是字母表单一真相源（26 字母去 I/O/L = 23，加 2-9 = 共 31 字符）；
// 正则由它派生、与 09 §10.2 genCode 共用同一字母表（真正排除 I/L/O）。
export const REDEEM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REDEEM_CODE_RE = /^[A-HJKMNP-Z2-9]{18}$/;   // ← 由 REDEEM_ALPHABET 派生，18 位，排除 I/L/O 与 0/1
export const RedeemRequest  = z.object({ code: z.string().regex(REDEEM_CODE_RE, '兑换码无效') });
export const RedeemResponse = z.object({ balanceMp: z.number().int(), creditsValueMp: z.number().int() });
```

```ts
// src/contracts/me.ts —— /api/me（含积分过期实时提示数据源 expiringSoon）
import { z } from 'zod';
export const MeResponse = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), role: z.string() }),
  balanceMp: z.number().int(),          // 单笔/余额安全用 number（§8.5 codec 表）
  maxConcurrency: z.number().int(),
  hasPaid: z.boolean(),
  // 3 天内即将过期的剩余毫积分：mp 走 string codec（SUM 聚合，避免精度风险），来源 SQL 见 §8.3
  expiringSoon: z.object({
    mp: z.string(),                     // string codec（与看板 SUM 同规则，§8.5）
    nearestExpiresAt: z.string().nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;
```

```ts
// src/contracts/notification.ts —— 站内通知
import { z } from 'zod';
export const NotificationItem = z.object({
  id: z.uuid(),
  type: z.enum(['image_expiring','announcement','inspiration_reviewed']),  // 后续新增类型在此扩枚举
  payload: z.record(z.string(), z.unknown()).nullable(),  // image_expiring:{imageId,expiresAt}｜inspiration_reviewed:{status,title,reason?,inspirationId?}
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export const NotificationListResponse = z.object({ items: z.array(NotificationItem) });
// 标记已读：缺省 ids → 全标该用户未读
export const MarkReadRequest = z.object({ ids: z.array(z.uuid()).optional() });
export type NotificationItem = z.infer<typeof NotificationItem>;
```

**毫积分跨 JSON 的 codec 规则**（[02-database.md §3.4](02-database.md)）：

| 量 | 量级 | JSON 类型 | Zod |
|---|---|---|---|
| 单笔金额（`creditsChargedMp`、`balanceMp`、套餐 `creditsMp/priceCash`） | ≤ 数万 mp，远 < `2^53` | `number` | `z.number().int()` |
| **SUM 聚合**（看板积分发放/消耗/负债总额；`/api/me` 的 `expiringSoon.mp`） | 可超 `2^53` | `string` | `z.string()` 或 bigint codec |

> 看板聚合**走 HTTP 查询 + string/bigint codec**，绝不用 JS `number` 直接 `SUM`（精度丢失），见 [10-ops-test.md §11.4](10-ops-test.md)。用户面单笔金额安全用 `number`；但凡 `SUM` 出来的量（含 `expiringSoon.mp`）一律 string codec，由 SQL 侧 `::text` 转字符串返回。

## 8.6 限流

**敏感入口按 IP + 账号双维度限流**（取两者更严者），命中返回 **429 `RATE_LIMITED`**，`details:{ retryAfterSec }`：

| 入口 | 阈值（默认，可调） | 计数维度 | 命中码 |
|---|---|---|---|
| `POST /api/redeem` | **5 次失败 / 10 分钟**（[§24-4](../redesign-requirements.md)） | IP + 账号，仅计**失败** | 429 `RATE_LIMITED` |
| `POST /api/auth/sign-in` | 10 次失败 / 10 分钟 | IP + 邮箱，仅计失败 | 429 `RATE_LIMITED` |
| `POST /api/auth/sign-up` | 5 次 / 小时 / IP | IP | 429 `RATE_LIMITED` |
| `POST /api/uploads` | **40 次 / 10 分钟**（图生图参考图上传） | 账号（每用户） | 429 `RATE_LIMITED` |
| `POST /api/generate` | 并发闸即主闸（[§14](../redesign-requirements.md)）；另**单日预算熔断** | 全站当日 | 429 `BUDGET_EXHAUSTED` |

**实现**：阶段一用 **DB 计数窗口**（轻量、无需 Redis）——`rate_limits(key, window_start, count)` 或直接 `COUNT events/audit_log WHERE … AND created_at > now()-interval`；阶段三规模化再迁 Upstash/KV（与队列演进同步，[01-architecture.md §2.5](01-architecture.md)）。

**预算熔断**在生成入口前置判定（`isDailyBudgetExhausted()`），超阈值即 **429 `BUDGET_EXHAUSTED`** + 告警，逻辑与阈值（`DAILY_RELAY_BUDGET_CALLS/MS`）见 [04-generation-pipeline.md §5.6](04-generation-pipeline.md)、每日重置 cron 见 [10-ops-test.md §11.8](10-ops-test.md)。

---

### API 红线清单（落地必守）

- [ ] 所有回前端响应**先脱敏**；`generate-status` 成功只给 R2 `public_url`，永不给中转临时 URL。
- [ ] `POST /api/generate` **不收任何 Key 字段**；`model/n/moderation` 服务端固定、忽略前端传值。
- [ ] 入队三闸顺序与码：并发 **409** / 余额 **402** / 预算 **429**（不入队、不扣费）。
- [ ] 生成失败用 **200 + body `status:'failed'`** 表达，不用 HTTP 错误码；`creditsChargedMp=0` 即"未扣"。
- [ ] 兑换 404/400 统一文案"兑换码无效"（防枚举）；410 才区分已用/已失效；失败计数才进限流。
- [ ] 金额跨 JSON：单笔 `number`、看板 SUM `string/bigint`，前后端复用 `src/contracts` 同一 schema。
- [ ] 错误一律走统一信封 `{error:{code,message,details?}}`，前端按 `code` 分支、不解析 `message`。
