---
paths:
  - "src/components/**"
  - "src/hooks/**"
  - "src/contracts/**"
  - "app/root.tsx"
  - "app/routes/_app*.tsx"
  - "app/routes/_auth*.tsx"
  - "app/routes/_admin*.tsx"
---

# 客户端安全红线（编辑前端 / 客户端可达代码时必守）

> 提醒 + 路由；权威看 规格 §22 + [docs/dev/07-api.md](../../docs/dev/07-api.md) / [08-frontend.md](../../docs/dev/08-frontend.md)。客户端 = 浏览器可达，绝不泄露密钥 / DB schema。

- **0 密钥**：URL/Key 只在服务端（`*.server.ts` / `netlify/functions/*`）从 `process.env` 注入；前端不收、不发、不存。
- **0 schema 泄露**：客户端可达模块**绝不 value-import** `src/db/*`（schema / drizzle）；要校验就**手写 Zod**（`src/contracts/*`）。⑤ 教训：`package`/`admin` 等契约手写、不引 db，否则整套钱 schema 进 bundle。
- 构建期 **`npm run assert-no-secrets`** 兜底（扫 build/client 无密钥值 + 无 schema 结构标记）；改完前端务必跑一次。
- 写端点在 `app/routes/api.*.ts`（**server-only**，同 `api.auth.$`）：读 **owner-scoped**（`WHERE user_id=$me`），敏感写 `requireUserStrict`（每请求查 DB + 封禁拦截）。
- 图片真下载/复制走 `src/lib/download.ts`（跨域 Supabase 公链 `<a download>` 会被忽略 → 必须 fetch blob）；SSR 安全：浏览器 API 只在事件回调里碰。
