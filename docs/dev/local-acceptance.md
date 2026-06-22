# 本地验收 / 运行指南（站长手动验收）

> 用浏览器跑通**注册 → 登录 → 生图 → 兑换 → 资产/灵感 → 后台**的验收手册。
> 代码层各链路已用 smoke 脚本对真 Neon/中转/Supabase 验证过（见末尾「无界面验收」）；本文是**开浏览器人工验收**的步骤。

## 0. 为什么用 `netlify dev`（不是 `npm run dev`）

| | `npm run dev`（react-router dev） | **`netlify dev`（推荐）** |
|---|---|---|
| 端口 | 5173（与 `BETTER_AUTH_URL` 不符）| **8888**（= `.env` 里 `BETTER_AUTH_URL`）✅ |
| 注入 `.env` 到 `process.env` | ❌ 否 → 钱/鉴权/存储 loader 报「缺少环境变量」 | ✅ 自动加载 `.env` |
| 服务 `netlify/functions/*`（生图 `generate`/`-background`/`status`、cron）| ❌ 不服务 → **生图打不通** | ✅ 服务 + 后台触发（`NETLIFY_DEV=true` → `triggerBackground` 走 localhost:8888）|

所以**生图验收必须用 `netlify dev`**。

## 1. 前置（一次性）

```bash
# 1) 安装 Netlify CLI（本地 devDep 或全局其一）
npm i -D netlify-cli            # 或：npm i -g netlify-cli

# 2) 确认 .env 已配齐（已 gitignore）：
#    DATABASE_URL / DATABASE_URL_UNPOOLED（Neon）
#    BETTER_AUTH_SECRET / BETTER_AUTH_URL=http://localhost:8888
#    STORAGE_S3_*（6 个，Supabase）/ RELAY_API_KEY / RELAY_BASE_URL
#    （可选）DAILY_RELAY_BUDGET_CALLS / _MS、SENTRY_DSN、ADMIN_ALERT_WEBHOOK

# 3) 确认数据库迁移 + 种子已应用（已对真 Neon 跑过；重置/换库时再跑）：
node --env-file=.env --import tsx scripts/db-verify.ts     # 应列出 2 套餐 + 8 config
#   若为空：先 npx drizzle-kit ... 应用 drizzle/*.sql，再 node --env-file=.env --import tsx src/db/seed.ts
```

## 2. 启动

```bash
# ⚠️ 起 dev 前清掉构建产物（否则 netlify dev 会优先服务 build/ 的「内置 SSR 函数 + 静态资源」，
#    而非 vite dev → 页面无 CSS/无 HMR、登录注册页「裸 HTML」样子。若刚跑过 npm run build / assert-no-secrets 必清）：
rm -rf build .netlify     # PowerShell：Remove-Item -Recurse -Force build, .netlify -ErrorAction SilentlyContinue

npx netlify dev           # 自动探测 React Router → 跑 vite dev（CSS Modules + tokens 正常）+ 函数 + .env
# → 打开 http://localhost:8888
```

> ⚠️ 端口必须是 **8888**（与 `BETTER_AUTH_URL` 一致），否则 Better Auth 会话/回跳会错。netlify dev 默认即 8888。
> ⚠️ **`netlify.toml [dev]` 只钉 `port = 8888`，不要设 `framework = "#custom"`**——后者会改走「内置 SSR 函数 + 静态 publish」混合模式，CSS 链接指向构建产物且无 vite client → **页面无样式**（本项目踩过，已记此坑）。

### 故障排查：页面「没样式 / 很丑」
是 `netlify dev` 在服务**构建产物**而非 vite dev。自查：浏览器 DevTools 看页面 `<head>` 的脚本——
- ✅ 正常（vite dev）：含 `/@vite/client`、源码路径 `/app/entry.client.tsx`，`document.styleSheets` 有规则
- ❌ 异常（服务 build）：是 `/assets/entry.client-<hash>.js` 这种哈希名、无 `/@vite/client`、CSS 文件 0 规则

修：停 dev → `rm -rf build .netlify` → 重启 `npx netlify dev`。

## 3. 验收清单（注册 → 登录 → 生图）

### ✅ 注册 → 登录（Better Auth，已 auth-smoke 验）
- [ ] `/register` 填邮箱+密码（≥6 位）→ 注册即登录（autoSignIn）→ 进主页三栏壳
- [ ] 右上/账号处余额显示 **0.14 积分**（= 注册赠送 140mp = 2 张），**30 天有效期**
- [ ] 退出 → `/login` 用同账号登录 → 回主页；错误密码提示「邮箱或密码错误」
- [ ] 受保护页未登录访问（如 `/assets`）→ 跳 `/login?next=…` → 登录后回跳

### ✅ 生图（DB-as-queue + 成功才扣，已 relay-smoke 真生图 + pipeline 真库验）
- [ ] Composer 输入提示词 → 选尺寸（6 档）→「生成」→ **生成中=宇宙星空动效 + `生成中 M:SS`**
- [ ] 约 **30–50s** 出图（真中转）→ 成功态出成品图 + 5 操作；**余额 −0.07**（扣到 0.07）
- [ ] 再生成第 2 张 → 余额 −0.07 → **0.00**；第 3 张应**积分不足拦截**（不入队、不扣费、引导去充值）
- [ ] 切到别的页面再回来，生成结果不丢（轮询由会话详情进行中轮驱动）
- [ ] （可选）人为造失败（如改中转 Key 触发 5xx）→ 失败态显报错 + **「未扣积分」**、余额不变

### ✅ 兑换码（需先有 active 码）
- [ ] 先发码：注册一个账号 → 提权管理员 → 后台发码（见 §4）；或直接用 `scripts/admin-smoke.ts` 造的码
- [ ] `/billing` 输 18 位码 → 兑换 → 「兑换成功，到账 N 积分」→ 余额增加；首次兑换后旧图保留期顺延 60 天
- [ ] 重复兑同一码 → 报错（已使用/无效）

### ✅ 资产库 / 搜索 / 灵感（P3-S1/S2 已上）
- [ ] `/assets`：图按日期分组；筛选「今天/近7天/近30天/**自定义**（起止日历）」；**搜索提示词**框过滤
- [ ] 「批量管理」→ Shift 连选 / **桌面拖拽框选** / **移动端长按进多选** → 打包下载(zip) / 删除（二次确认）
- [ ] 剩 ≤3 天的图显示「N 天后过期」角标
- [ ] 侧栏**搜索框**搜会话标题 → 结果点选跳对应会话
- [ ] `/inspiration`：灵感画廊瀑布流；「用此提示词」一键带回 Composer

## 4. 后台验收（/admin，需管理员）

两种建管理员方式（都双写 users.role + Better Auth user.role，即时生效）：

```bash
# A) 写死管理员（推荐，幂等）：.env 设 SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD（密码进 .env 不进 git），一条命令建号+提权
node --env-file=.env --import tsx scripts/seed-admin.ts

# B) 已有账号提权：先 /register 注册，再
node --env-file=.env --import tsx scripts/promote-admin.ts <你的邮箱>
```
> 🔑 凭据放 `.env`（已 gitignore），**绝不写进源码/提交**（密码进 git 历史=泄露）。新库流程：迁移 + seed → 跑 `seed-admin.ts`。
- [ ] `/admin` 进得去（非 admin 访问应被 redirect，不暴露后台存在）
- [ ] 兑换码（批量发码/CSV 导出/作废/对账）、用户（搜索/详情/封禁/改密/调积分/调并发）、套餐、全局参数、生成记录、灵感库 CRUD、数据看板、操作审计

## 5. 无界面验收（不开浏览器，对真后端跑脚本）

每条都 `node --env-file=.env --import tsx scripts/<x>.ts`，自建测试数据→断言→清理：

| 脚本 | 验什么 |
|---|---|
| `auth-smoke.ts` | 注册 → 送 140mp → 幂等 |
| `relay-smoke.ts` | **真中转生图** → Supabase → public_url 200 |
| `reads-smoke.ts` | 端到端：注册→送140→兑换→生成→详情/资产回流→存入→删除→限流（25 检查）|
| `admin-smoke.ts` | 后台全套（发码/用户/调积分/套餐/灵感/看板/审计，27 检查）|
| `search-smoke.ts` | 搜索（owner-scoped/转义/ILIKE，13 检查）|
| `cron-smoke.ts` | cron（超时重扫/过期/对账/清图/预算，27 检查，注入 R2 桩）|
| `db-verify.ts` / `db-smoke.ts` / `storage-smoke.ts` | 种子/迁移 / FOR UPDATE / 存储往返 |
| `npm run test:money` | 钱链路 33 例真库（并发/重入/幂等）|

## 6. 验收须知

- **真生图花真钱**：每张走真中转（成本对账 0.07 定价的实测见 [cost-reconciliation.md](cost-reconciliation.md)，**毛利数待你灰度 ≥200 张跑量后填**）。验收少量即可。
- 生图 **5 分钟超时**兜底；**一旦开始不可取消**。
- 失败/超时**不扣费**；成功（落图）才扣 0.07。
- 阶段三 P3-S1（资产框选/长按）的**手势交互**建议在真浏览器点一遍（headless 难自动验）。
