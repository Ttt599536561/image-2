# 13 · 生产部署（Netlify）

> 本项目部署目标 = **Netlify**（用 Netlify Functions + Scheduled cron + `netlify.toml`，换普通 VPS 跑不起来、要改架构）。
> 首次上线于 **2026-06-22**。本文是**可复跑的部署 runbook** + 生产现状 + 运维待办。

## 0. 生产现状（2026-06-22 首发）
- **站点 URL**：https://ai-image-workshop-612.netlify.app
- **Netlify**：站点 `ai-image-workshop-612`，Project ID `8d1419c8-2ec3-49d9-936f-0f79df9643b5`，team `qkb964199910`（账号 `qkb964199910@gmail.com`）。
- **后端复用现有云服务**（无需改）：Neon Postgres（us-east-1）/ Supabase Storage（ap-northeast-2 桶 `images`）/ 中转 `api.tangguo.xin`。**生产与本地是同一个 Neon 库**（管理员/套餐/历史数据共享）。
- **部署方式**：Netlify CLI（**非** Git 连接）—— 本地 `netlify deploy --prod` 直传构建产物 + 函数。
- **验证**：`/login` 200（SSR）· 真实管理员 `POST /api/auth/sign-in/email` 200+Set-Cookie（= SSR+Better Auth+Neon+env+Cookie 全链路）· `/api/me`(未登录) 401。

## 1. 前置（一次性）
1. **Netlify 账号** + 一个 **Personal Access Token**（User settings → Applications → Personal access tokens）。
2. token 放进 `.env`（gitignored）：`NETLIFY_AUTH_TOKEN=nfp_…`。后续所有 `netlify` 命令前先从 `.env` 读到环境：
   ```powershell
   $env:NETLIFY_AUTH_TOKEN = ((Select-String -Path .env -Pattern '^NETLIFY_AUTH_TOKEN=' | Select-Object -First 1).Line -replace '^NETLIFY_AUTH_TOKEN=','')
   ```
3. CLI 走 `npx netlify …`（仓库 devDep 装了 `netlify-cli`，未全局装）。

## 2. 首次建站 + 配置（已做，留作参考）
```powershell
# 建站（自动 link 到当前目录；名字占用会自动加后缀）
npx netlify sites:create --name ai-image-workshop      # → ai-image-workshop-612.netlify.app

# 配 12 个生产环境变量：复用 .env 的 11 个 + BETTER_AUTH_URL 覆盖为生产域名。
#   不进生产的：SEED_ADMIN_*（仅本地 seed 脚本用，管理员已在 Neon）、NETLIFY_AUTH_TOKEN。
#   做法：用 Select-String 逐键取行（Get-Content 会因行尾/编码漏 S3/长值行，已踩坑），生成临时 .env.production 再 import。
$keys = 'DATABASE_URL','DATABASE_URL_UNPOOLED','BETTER_AUTH_SECRET','STORAGE_S3_ENDPOINT','STORAGE_S3_REGION','STORAGE_S3_ACCESS_KEY_ID','STORAGE_S3_SECRET_ACCESS_KEY','STORAGE_BUCKET','STORAGE_PUBLIC_BASE_URL','RELAY_API_KEY','RELAY_BASE_URL'
$out = @(); foreach ($k in $keys) { $m = Select-String -Path .env -Pattern ("^"+[regex]::Escape($k)+"=") | Select-Object -First 1; if ($m) { $out += $m.Line.TrimEnd("`r") } }
$out += 'BETTER_AUTH_URL=https://ai-image-workshop-612.netlify.app'
[IO.File]::WriteAllLines((Join-Path (Get-Location) '.env.production'), $out)   # UTF-8 无 BOM
npx netlify env:import .env.production
Remove-Item .env.production -Force
```
**🔴 红线**：`BETTER_AUTH_URL` 必须是**生产域名**（不是 `localhost:8888`），否则登录/Cookie 全废。绑自定义域后要改这个 env 并重新部署。

## 3. 部署 / 重新部署
```powershell
$env:NETLIFY_AUTH_TOKEN = ((Select-String -Path .env -Pattern '^NETLIFY_AUTH_TOKEN=' | Select-Object -First 1).Line -replace '^NETLIFY_AUTH_TOKEN=','')
npx netlify deploy --prod        # 跑 netlify build（=npm run build + 插件生成 SSR 函数 + 打包 netlify/functions）后发布
```
- `@netlify/vite-plugin-react-router` 在 Netlify build 阶段生成 SSR 函数 `react-router-server.mjs`；`netlify/functions/*`（生图 3 + cron 5）一并打包。
- cron Scheduled Functions 部署后**自动按 `netlify.toml` 的 schedule 运行**（UTC）。
- **改了环境变量**后必须**重新部署**才生效。

## 4. 部署后验证（冒烟）
```powershell
$base='https://ai-image-workshop-612.netlify.app'
Invoke-WebRequest "$base/login" -UseBasicParsing                              # 期望 200
# 真实管理员登录（SEED_ADMIN_* 从 .env 读）→ 期望 200 + Set-Cookie
```
浏览器逐态：注册→生图（文生图/图生图）→兑换→后台。

## 5. 运维待办 / 坑（不挡用，扩量再处理）
- **连接池**：当前 `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED` 指向**同一直连串**（没配 Neon `-pooler` 池化串）。高并发 WS 事务（扣费/兑换/调账）可能撞直连连接上限 → 真有量前补一条 `-pooler` 串到 `DATABASE_URL`（HTTP 看板用），保留直连给 `_UNPOOLED`（WS 事务用）。
- **可选告警 env**：`SENTRY_DSN` / `ADMIN_ALERT_WEBHOOK` 未配（缺则 no-op）；要监控就 `netlify env:set` 上去再 redeploy。
- **成本/合规**：注册即送 0.14 积分=真钱，站已公开任何人可注册；内容审核本期不做（站长定、风险自负）。按需加注册门槛。
- **自定义域**：Netlify → Domain management 绑定 → DNS 指向 → 改 `BETTER_AUTH_URL` env → redeploy。
- **密钥轮换**：部署用的 token + DB/存储/中转密钥若曾在不安全渠道出现过，及时轮换（先撤旧 Netlify token）。
- **图生图速度**：生产在美西机房、跨境下载快，i2i 比本地（国内跨境）明显快；管线已强制 `response_format=b64_json` 免二次下载（见 [04-generation-pipeline.md](04-generation-pipeline.md)），并有 `[gen-timing]` 日志（Netlify Function logs 可查）。
