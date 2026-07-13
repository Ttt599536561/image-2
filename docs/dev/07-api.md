# API 契约

状态：本章只描述当前 React Router/Docker API。Zod 源码是字段级真相源，产品规则见
[redesign-requirements.md](../redesign-requirements.md)。

## 8.1 统一响应

错误统一为：

```json
{ "error": { "code": "ERROR_CODE", "message": "可读且已脱敏的文案" } }
```

`details` 仅用于非敏感结构化信息。任何响应、校验错误或日志都不得包含 system/custom
Key、credential ID、密文、IV 或 auth tag。

## 8.2 状态码

| HTTP | 语义 |
|---|---|
| 200 | 查询或同步动作成功；generation 失败也以 200 + body 业务态返回 |
| 202 | generation 已持久入队，等待 worker 消费 |
| 400 | 请求体、参数、文件类型/大小或模式组合无效 |
| 401/403 | 未登录；已封禁或无 admin 权限 |
| 402 | system 积分不足 |
| 404 | owner-scoped 资源不存在或不属于当前用户，两者不区分 |
| 409 | system 并发冲突或其他资源冲突 |
| 410 | 兑换码已使用或已失效 |
| 429 | 业务限流或 system 预算熔断 |
| 503 | custom 模式功能开关关闭 |

## 8.3 端点

| 域 | 端点 |
|---|---|
| 鉴权/账号 | `/api/auth/*`、`GET /api/me`、账号积分批次/流水/兑换记录 |
| 会话 | `/api/conversations`、`/api/conversations/:id` |
| 生图 | `POST /api/uploads`、`POST /api/generate`、`GET /api/generate-status` |
| 图片 | `/api/images`、保存、删除、下载相关资源路由 |
| 充值 | `GET /api/packages`、`POST /api/redeem` |
| 灵感 | `/api/inspirations`、`/api/inspiration-submissions` |
| 通知 | `GET /api/notifications`、`POST /api/notifications/read` |
| 后台 | `/api/admin/*`，每个端点独立执行 `requireAdmin`；详见 [09-admin.md](09-admin.md) |

读路径可由 loader 暴露，写路径使用 RR resource route/action。迁移期部分资源路由仍导入
`netlify/functions` 目录中的平台无关 handler 源码；这不依赖 Netlify 托管运行时。

### 当前生成请求

`POST /api/generate` 使用唯一 `GenerateRequest`：prompt 最长 4000，`inputImageKey`
最长 300；客户端可提供 conversation/generation UUID 以支持乐观导航，也可为当前对话结果编辑提供 `sourceImageId` UUID。请求不能携带 Base URL、model、n、moderation、storage key、文件路径或外部来源 URL。

- 缺 `credentialMode` 且无 Key 兼容为 system。
- system 携带 `customApiKey` 返回 `400 SYSTEM_MODE_FORBIDS_CUSTOM_KEY`。
- custom 必须携带 trim 后非空、最长 500 的 Key；功能关闭返回
  `503 CUSTOM_KEY_MODES_DISABLED`，且不创建 generation/credential。
- system 入队前执行余额、system 并发和预算闸；custom 跳过这些本站闸并始终零扣费。
- `sourceImageId` 与 `inputImageKey` 互斥；来源必须是当前 user 在当前 conversation 中的成功图片。伪造、越权、非成功或已删除来源统一返回 `404 SOURCE_IMAGE_UNAVAILABLE`，且不创建任务。
- 成功返回 `202 { generationId, conversationId, status, credentialMode, deadlineAt }`。

`POST /api/uploads` 接收单个 PNG/JPEG/WEBP，服务端按魔数判断，应用上限 4MB；非法或
超限当前均返回 400。上传 key 必须属于当前 user 的 `uploads/<userId>/` 前缀。

`GET /api/generate-status` 支持 `?id=` 单项和 `?ids=` 批量，两者互斥；批量去重后最多
50 个。服务端始终按当前 user 过滤；批量结果用 `missingIds` 合并“不存在/非 owner”。
成功只返回稳定对象存储 `publicUrl`，失败返回脱敏错误与 `creditsChargedMp:0`。状态和会话详情还返回 `sourceImageId` 与 owner-scoped `sourceImage` 公共摘要；来源已清理时 ID 保留、摘要为 `null`。

## 8.4 兑换

兑换码格式由 `src/contracts/redeem.ts` 的 `REDEEM_ALPHABET`/正则统一定义。不存在或
格式错误使用相同“兑换码无效”文案，避免枚举；只有已用/已作废返回 410 的明确子因。
核销使用状态谓词与唯一约束，只有 active 码能在事务内入账一次。

## 8.5 Zod 真相源

字段、枚举和长度不要复制到文档或组件中；直接复用：

- `src/contracts/generate.ts`：生成请求、状态、错误码与批量读取。
- `src/contracts/error.ts`：统一错误信封。
- `src/contracts/upload.ts`：上传类型、4MB 上限与魔数嗅探。
- `src/contracts/redeem.ts`：兑换格式和响应。
- `src/contracts/notification.ts`：图片到期、后台公告、灵感审核通知。
- `src/contracts/admin.ts`：后台请求/响应。

## 8.6 限流

限流维度由 `src/server/rateLimit.ts` 统一处理。只有 `TRUST_PROXY=true` 时才信任 Caddy
写入的 `x-forwarded-for`；否则不从客户端头推断 IP。当前关键规则包括参考图上传每用户
40 次/10 分钟、兑换失败 5 次/10 分钟，以及登录/注册等敏感入口限制。custom 生图按
批准产品决策不设提交限流，但仍受鉴权、owner-scope、参数、deadline 和 kill switch 约束。

## 8.7 Key 与任务状态

system/custom 共用一个状态机：`queued -> claimed -> running -> succeeded|failed`。
`deadlineAt` 从服务端创建时间起算 5 分钟。custom Key 只按 generation 加密暂存，终态
立即删除；system/custom relay 错误都先脱敏。custom 不得自动回退 system，也不得触碰
`credit_accounts`、`credit_lots`、`credit_ledger` 或 system budget/concurrency 计数。
