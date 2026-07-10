# 13 · 生产部署（Netlify）

> 本项目部署目标 = **Netlify**（用 Netlify Functions + Scheduled cron + `netlify.toml`，换普通 VPS 跑不起来、要改架构）。
> 首次上线于 **2026-06-22**。本文是**可复跑的部署 runbook** + 生产现状 + 运维待办。

## 0. 生产现状（2026-06-22 首发）
- **站点 URL**：https://ai-image-workshop-612.netlify.app
- **Netlify**：站点 `ai-image-workshop-612`，Project ID 与 team 标识只从 Netlify 控制台/密码管理器读取；文档不记录操作方账号邮箱。
- **后端复用现有云服务**（无需改）：Neon Postgres（us-east-1）/ Supabase Storage（ap-northeast-2 桶 `images`）/ 中转 `api.tangguo.xin`。**生产与本地是同一个 Neon 库**（管理员/套餐/历史数据共享）。
- **部署方式**：Netlify CLI（**非** Git 连接）—— 本地 `netlify deploy --prod` 直传构建产物 + 函数。
- **验证**：`/login` 200（SSR）· 真实管理员 `POST /api/auth/sign-in/email` 200+Set-Cookie（= SSR+Better Auth+Neon+env+Cookie 全链路）· `/api/me`(未登录) 401。

### 0.1 2026-07-11 待部署功能说明

系统/自定义 Key、多任务和统一五分钟 deadline **只有需求与实施计划，当前生产尚未支持**。在代码、`0005` 迁移、测试和本节部署闸全部完成前：

- 不要给生产设置 `CUSTOM_KEY_JOB_ENCRYPTION_KEY` 后就宣称功能可用；当前代码不会读取它。
- 不要单独部署前端 Key 弹窗或只部署 migration。前端、统一 API、凭据加密、Background 分流、零扣费事务、状态收口必须作为一套兼容发布。
- 当前 system relay 后台配置和 `RELAY_*` env 保持原样；custom 固定 URL 不新增后台参数。

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

> **当前生产 = `42d8a0b`（2026-06-23，含全部优化波 + 后台素材库本地上传 + 🆕 灵感库用户投稿与审核 UGC §13.1；deploy `6a3aa2bd`）**。本会话部署均用显式 `--site 8d1419c8-2ec3-49d9-936f-0f79df9643b5`（清过 `.netlify` 后不再有本地 link，靠它免交互选站）。

## 3. 部署 / 重新部署
```powershell
$env:NETLIFY_AUTH_TOKEN = ((Select-String -Path .env -Pattern '^NETLIFY_AUTH_TOKEN=' | Select-Object -First 1).Line -replace '^NETLIFY_AUTH_TOKEN=','')
npx netlify deploy --prod --site 8d1419c8-2ec3-49d9-936f-0f79df9643b5   # 跑 netlify build 后发布（--site 免交互）
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
- **🆕 换中转站不用改 env / 不用重部署**（2026-06-23）：后台「套餐 / 参数」页 → **「中转站配置」区**可改 `relay_base_url` + `relay_api_key`（存 `app_config`，`relay.ts` 读时**优先 app_config、回退 env**，即时生效）。Key **写后即焚**（GET 只回末 4 位 hint、绝不回明文）。env 的 `RELAY_*` 仍作回退兜底，可保留。
- **🆕 出图触发已改 `await`**（2026-06-23 `e41d4d5`）：`triggerBackground` 由 fire-and-forget 改 await（serverless 返回后会冻结掐死未 await 的 fetch，导致任务干等兜底 cron）。若再遇"出图久等"先查 Netlify Function logs 的 `[triggerBackground]` / `[gen-timing]`；兜底 cron `dispatchStaleQueued` 阈值 45s。

## 6. Key 模式功能部署闸（实施完成后执行）

### 新增生产环境变量

`CUSTOM_KEY_JOB_ENCRYPTION_KEY`：32 字节随机主密钥的 base64 表示，只供服务端 AES-256-GCM 加解密 generation-scoped 临时凭据。`CUSTOM_KEY_MODES_ENABLED` 是缺省关闭的运维 kill switch；暗部署时必须为 `false`。

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$key = [Convert]::ToBase64String($bytes)
npx netlify env:set CUSTOM_KEY_JOB_ENCRYPTION_KEY $key --site 8d1419c8-2ec3-49d9-936f-0f79df9643b5
npx netlify env:set CUSTOM_KEY_MODES_ENABLED false --site 8d1419c8-2ec3-49d9-936f-0f79df9643b5
$rng.Dispose()
Remove-Variable bytes, rng, key
```

- 不把真实值写进 `.env.example`、文档、终端录屏、提交或审计日志。本地 `.env` 只存本地/测试值并继续 gitignore。
- `key_version=1` 随密文保存。首版轮换前先排空/清理全部 `generation_credentials`；若未来要无损轮换，改成按 version 同时持有新旧主密钥后再轮换。
- 改 env 后重新部署。缺失/长度错误时 custom 入队应 fail closed 且不返回 202；system 必须不受影响。

### 发布顺序

1. 在维护窗口确认无长时间在途任务，备份数据库，应用 `0005`（新增列/表均向后兼容）。
2. 运行 schema/迁移验证，确认存量 `credential_mode='system'`、`deadline_at` 回填正确、凭据表为空。
3. 设置主密钥并保持 `CUSTOM_KEY_MODES_ENABLED=false`，部署完整代码；确认 cleanup Scheduled Function 存在。
4. 暗部署验证：system 文生图/图生图、余额、预算、并发、一次扣费不回归；custom 返回 503 且 generation/credential/background 均零写入。
5. 设置 `CUSTOM_KEY_MODES_ENABLED=true` 并重新部署，再用专用测试 Key 跑 custom：零余额、连续 3 任务、t2i/i2i、失败映射、deadline、图片历史、零 debit、终态凭据清空。
6. 检查 Function logs/Sentry 桩/DB 普通表/用户和 admin 响应无测试 Key；确认终态立即删除凭据，以及 10 分钟 TTL + 5 分钟 cron 的正常最迟 15 分钟孤儿清理边界。
7. 演练一次关闭开关后的 UI/API 行为与 rollback dry-run；完成后才更新 [PROGRESS.md](../PROGRESS.md) 的里程碑 14、生产 commit 和新测试基线。

### 回滚

- UI/API 回滚前先设置 `CUSTOM_KEY_MODES_ENABLED=false` 并部署，确认 custom 固定 503/零写入，再等待在途 custom 最多 5 分钟；不要让旧代码接到它无法解密的 queued custom 行。
- migration 新列/表保持不删，旧 system 代码可忽略向后兼容结构；不要在紧急回滚中 `DROP` 数据结构。
- 主密钥在 `generation_credentials` 与 custom 非终态均确认归零前不得删除或轮换；否则在途 worker 无法解密并安全收口。
- 若仍有在途任务，先执行默认 dry-run（无需 confirm）：

```powershell
node --env-file=.env --import tsx scripts/fail-custom-generations.ts --admin-id "<ADMIN_UUID>" --reason "rollback audit"
```

- 确认范围后才执行 apply：

```powershell
node --env-file=.env --import tsx scripts/fail-custom-generations.ts --admin-id "<ADMIN_UUID>" --reason "rollback containment" --apply --confirm FAIL_CUSTOM_GENERATIONS
```

- apply 原子收口 failed、清凭据并写审计；脚本不得 SELECT/export/decrypt ciphertext。复查 custom 非终态和凭据均为 0 后，才允许回滚应用代码及处理主密钥。
