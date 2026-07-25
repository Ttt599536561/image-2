# 任务：修复 CI 依赖审计失败（3 个 high 漏洞）

## 背景与目标

2026-07-25 push main 后 CI 的 `npm audit --audit-level=high` 步骤失败。
原因：GitHub CVE 库新披露了命中项目已锁定版本的 advisory（非本次代码
改动引入，本次推送只是触发 CI 暴露它）：

| 依赖 | 当前 | 风险 | 修复版本 | 影响面评估 |
|---|---|---|---|---|
| react-router 四件套 | 8.0.1 | RSC Mode CSRF Bypass（high） | 8.3.0 | 我们用 framework mode SSR，不用 RSC Mode，攻击面不适用但门禁要绿 |
| better-auth | 1.6.20 | magic-link/email-OTP 预账户劫持（high） | 1.6.25 | 只用邮箱+密码登录，未启用 magicLink/emailOTP 插件（已查 auth.ts），攻击面不适用但门禁要绿 |
| postcss | 旧版 | source map 路径遍历（high） | audit fix 自动 | 构建链间接依赖 |

## 涉及文件 / 模块（AI 填）

- `package.json` / `package-lock.json`

## 明确不做什么 ⚠️

- 不改任何业务代码
- 不顺手升级其他依赖（moderate 的 esbuild/valibot 不影响门禁，不动）
- 不动 drizzle-kit（其 esbuild moderate 修复是 breaking，不引入）

## 验收步骤 ⚠️

1. `npm audit --audit-level=high` 退出码 0（0 high）
2. `npm run typecheck` / `npm run test:run` / `npm run build` 全绿
3. dev 冒烟：首页与登录页 HTTP 200（better-auth 是认证库，必须冒烟）
4. push 后盯 GitHub Actions，CI 变绿才算完成

## 需要跑的验收命令（AI 填）

- typecheck + test:run + build + audit + dev 冒烟

## 风险与注意点（AI 填）

- better-auth 升级涉及登录会话：1.6.20 → 1.6.25 为 patch 级，风险低，
  但必须跑全套测试 + 冒烟
- react-router 8.0.1 → 8.3.0 为同 major minor 升级，API 兼容
- 教训已记录：push main 前必须本地跑 VERIFY.md 第四节发布命令
  （build/audit），push 后必须检查 CI 状态

## 状态

进行中
