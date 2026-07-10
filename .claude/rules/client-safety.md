---
paths:
  - "src/components/**"
  - "src/hooks/**"
  - "src/contracts/**"
  - "src/lib/userApiConfig.ts"
  - "src/lib/redaction.ts"
  - "src/server/relay.ts"
  - "src/server/generation/credential.server.ts"
  - "netlify/functions/generate*.ts"
  - "app/root.tsx"
  - "app/routes/_app*.tsx"
  - "app/routes/_auth*.tsx"
  - "app/routes/_admin*.tsx"
---

# 客户端与生图凭据安全红线（编辑客户端可达代码 / 凭据边界时必守）

> 提醒 + 路由；权威看 规格 §22/§25 + [当前 PRD](../../tasks/prd-user-api-key-modes.md) + [docs/dev/07-api.md](../../docs/dev/07-api.md) / [08-frontend.md](../../docs/dev/08-frontend.md)。客户端 = 浏览器可达；系统/基础设施密钥绝不泄露，custom Key 只走已批准的受控链路。

- **系统密钥零泄露**：`RELAY_*`、数据库、存储、鉴权和任务加密密钥只在服务端；不得进入客户端 bundle、API 响应或浏览器存储。
- **custom Key 唯一例外**：按登录 user ID 明文存 `localStorage`，仅在用户选择 custom 时随 HTTPS `POST /api/generate` 请求体发送。固定 URL 只展示、不从客户端发送。禁止写日志、Sentry、错误、事件、审计、普通 generation 字段或任何响应；服务端只能保存 generation-scoped 密文并在终态删除。
- **0 schema 泄露**：客户端可达模块**绝不 value-import** `src/db/*`（schema / drizzle）；要校验就**手写 Zod**（`src/contracts/*`）。⑤ 教训：`package`/`admin` 等契约手写、不引 db，否则整套钱 schema 进 bundle。
- 构建期 **`npm run assert-no-secrets`** 继续兜底系统秘密与 schema；另加运行时哨兵测试，证明 custom Key 除 `localStorage` 和本次 HTTPS 请求体外不出现在持久化、日志、错误或响应。
- 写端点在 `app/routes/api.*.ts`（**server-only**，同 `api.auth.$`）：读 **owner-scoped**（`WHERE user_id=$me`），敏感写 `requireUserStrict`（每请求查 DB + 封禁拦截）。
- 图片真下载/复制走 `src/lib/download.ts`（跨域 Supabase 公链 `<a download>` 会被忽略 → 必须 fetch blob）；SSR 安全：浏览器 API 只在事件回调里碰。
