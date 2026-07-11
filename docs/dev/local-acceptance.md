# 本地验收 / 运行指南（站长手动验收）

> 用浏览器跑通**注册 → 登录 → 生图 → 兑换 → 资产/灵感 → 后台**的验收手册。
> 代码层各链路已用 smoke 脚本对真 Neon/中转/Supabase 验证过（见末尾「无界面验收」）；本文是**开浏览器人工验收**的步骤。

## 当前本地实现状态（2026-07-11）

- system/custom Key 模式、多任务生成、批量状态轮询、统一 5 分钟 deadline、暂停/缺失/失败 UI 和管理员记录已在本地完成。
- 受 test-env guard 保护的本地完整服务地址：`http://localhost:8888`。`npm run dev:netlify:test` 同时提供页面、`/api/generate*` 和一次性本地图片存储；Playwright 已覆盖 system 锁定、custom 连续任务、deadline 恢复、missing tombstone、账号隔离/清除和四种视口键设置弹窗。
- 新鲜结果：187/187 单元、74/74 金额测试、构建、类型检查、敏感信息扫描通过；E2E 6 条通过，旧生产 smoke 1 条安全跳过。
- 这些结果只证明本地 disposable 环境；未连接生产数据库、未运行生产 smoke、未部署 Netlify，也未启用生产 custom 开关。

## 0. Key 模式为什么必须用完整本地服务

| 命令 | 用途 | 真实本地 `/api/generate*` |
|---|---|---|
| **`npm run dev:netlify:test`** | 本地手工验收；只读受 guard 保护的 `.env.test` | ✅ 页面、生成 API、状态 API和图片读取均可用 |
| `npm run dev:ui:test` | Playwright 的页面与浏览器 mock 验收 | ❌ 不提供真实生成 API，不能用于手工生图 |
| `npm run dev` | 裸 React Router 开发 | ❌ 不提供 Netlify Functions，且端口可能与 Auth 回跳不一致 |

所以 **Key 模式手工生图验收只使用 `npm run dev:netlify:test`**。启动器会避开被其他项目占用的 5173，显式选择 React Router target port，再由 8888 代理对外；不要据 `dev:ui:test` 的页面外观判断真实生成链路可用。

## 1. 前置（一次性）

```bash
npm install

# 首次或更换 disposable 测试数据库后应用测试迁移；命令本身经过 test-env guard。
npm run db:test:migrate
```

`.env.test` 必须保持 gitignored，并通过 disposable 数据库确认、测试 Auth、Key 模式开关与主密钥检查。guard 会拒绝与本机生产候选同目标的数据库，也会清空继承的 PostgreSQL 连接覆盖项、生产中转、存储和可观测凭据。不要把 `.env` 改名或复制成 `.env.test`。

## 2. 启动

```bash
npm run dev:netlify:test
# → 打开 http://localhost:8888
```

启动器只清理生成的 `build/` 与 `.netlify/functions-serve/`，保留 `.netlify/` 下其他本地状态；生成图片写入 gitignored 的 `.netlify/local-storage/`。它不会读取生产 S3 配置，也不会删除整个 `.netlify/`。

### 故障排查：页面「没样式 / 很丑」
先确认启动命令确实是 `npm run dev:netlify:test`，而不是仍在运行旧的 `npm run dev` / `dev:ui:test`。正常页面的 `<head>` 含 `/@vite/client`；若仍看到哈希构建资源，停止旧进程后重新运行受保护启动器。
- ✅ 正常（vite dev）：含 `/@vite/client`、源码路径 `/app/entry.client.tsx`，`document.styleSheets` 有规则
- ❌ 异常（服务 build）：是 `/assets/entry.client-<hash>.js` 这种哈希名、无 `/@vite/client`、CSS 文件 0 规则

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

### ✅ 灵感投稿 / 审核（UGC，详见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)）

- [ ] `/inspiration` 标题行点「投稿」→ 从「我的作品」选图 → 填标题/提示词/分类/简介 → 提交（不扣积分）→「我的投稿」出现待审记录。
- [ ] 重复投稿同一张仍待审或已在架的图时，明确提示已投稿且不重复入队。
- [ ] 后台 `/admin/inspiration-submissions` 出现待审记录和导航红点；通过时可编辑字段并二次确认，驳回时必须填写原因。
- [ ] 投稿人收到 `inspiration_reviewed` 铃铛通知，点通知跳回 `/inspiration`；通过卡显示掩码署名，站长自建卡不显示署名。

## 3a. Key 模式与多任务验收（2026-07-11，实施后执行）

> 以下项目已有本地自动化覆盖，仍需按需手工走查；不得据此声称生产已有功能。只用 `npm run dev:netlify:test` 启动本地 custom 验收，并只读 gitignored `.env.test`。guard 必须拒绝与 `.env` 生产候选同目标的数据库；本地手工验收也不得绕过 guard 直读 `.env`。真实环境验证仅按 [deploy.md §6](deploy.md) 的受控发布步骤执行。

### 顶栏与本地配置

- [ ] 顶栏 KeyRound 图标在欢迎页/会话页等共用 TopBar 页面可见，有 tooltip 和键盘可访问名称；360px 与桌面均不挤压积分、通知、主题按钮。
- [ ] 首次打开默认 system；弹窗 system/custom 只能单选。custom 区有密码输入、显隐、保存、清除；URL 固定显示 `https://api.tangguo.xin/v1` 且不可编辑。
- [ ] 保存空白/超长 Key 只做本地校验，不发请求；保存有效 Key 自动切 custom。切 system 后 Key 仍在；清除后 Key 删除并切 system。
- [ ] 刷新和重新登录恢复该 user ID 的模式/Key；同浏览器账号 A/B 配置隔离。退出登录不删除；浏览器 DevTools 可确认是已接受的明文 localStorage，不存在伪加密文案。
- [ ] Network 面板确认 system 请求只含 `credentialMode:"system"`，custom 请求含 `credentialMode:"custom"` + `customApiKey`，两者都不含 Base URL；两者 URL 都是本站同一个 `/api/generate`。
- [ ] `CUSTOM_KEY_MODES_ENABLED=false` 时 custom 控件禁用/提示暂停，已存 Key 不删除，API 503 且零写入；system 仍可用，UI 不得静默把 custom 改成 system。

### system 回归

- [ ] 余额不足仍 402、不入队；达到账户并发仍 409；system 预算满仍 429。
- [ ] system t2i/i2i 只使用后台 system Key；成功只扣一次，失败/超时不扣；后台换中转站能力不变。
- [ ] system 保留同会话单项交互锁，第一张终态后 Composer 恢复；服务端并发只统计 system 行，custom 行不占 `max_concurrency` 槽。

### custom 生成与多任务

- [ ] 测试账号余额为 0、system 预算/并发已满时，custom 仍可 202 入队。
- [ ] 连续提交至少 3 个不同提示词，不等前一张完成；3 张卡同时保持各自 prompt、比例、elapsed/status，不串图、不覆盖。
- [ ] 一个轮询控制器把当前会话非终态 generation 按每批 `<=50` 分片；用 51+ 项验证自动分片与合并。`missingIds` 不区分不存在/非 owner，连续两次缺失会刷新会话；权威刷新后仍缺失则显示“任务不存在或无权访问”并停止只轮询该 ID，不伪造服务端终态；任一项终态后其余继续轮询，刷新/离开再回来仍恢复。
- [ ] custom 文生图和图生图都成功；图片进入同一会话、右侧面板、资产库和对象存储，下载/删除/保留期与 system 相同。
- [ ] 每个 custom 成功项显示“不扣积分”/`creditsChargedMp=0`；余额、lots、ledger 前后完全不变，后台生成记录 mode=custom、扣费 0。

### 失败、超时与秘密

- [ ] 分别用无效 Key、无配额 Key/桩、普通 429、内容拒绝、断网/上游不可达、坏响应和存储失败，核对批准版错误码与文案；失败后仍保持 custom 模式/Key，不自动调用 system。
- [ ] 用可控桩/虚拟时钟验证 system/custom 均从创建起 5 分钟收口，fetch 预留 30 秒；状态读取可在 cron 前得到 `provider_timeout`，文案“请求超时，本站未扣积分，请重试”，custom 同时说明第三方计费边界。
- [ ] 成功、失败、超时后 `generation_credentials` 立即无对应行；人为制造孤儿，验证 10 分钟 TTL 与 5 分钟 cron 的正常最坏 15 分钟物理清理边界。queued/claimed/running 都能超时，不留卡死并发。
- [ ] 用高熵测试 Key 搜索普通 DB 字段、events、audit、Function logs、Sentry 桩、用户/admin 响应和错误；不得命中明文。凭据表只见密文/IV/tag，后台 UI/API 不可读取。

## 3b. 阶段三+ 验收反馈 20 条（本轮新增/改动，重点看这些）

> 全部完成：A(8) `59a09c7` · B(图片操作 5) `5c1e5b8` · C(新能力 4) `8aa24ec` · D(大重构 3) `af62860`。下表是 B/C/D 的浏览器验收点（A 多为 CSS/文案，随手看）。

### Wave B 图片操作（#17/#18/#19/#20/#1）
- [ ] **成功态**：图**右下角**有悬浮「下载」键，点击**真下载**（不再只是开新标签）；动作条首键是「**复制图片**」（点后剪贴板可粘贴该图）；另有「复制提示词」「重新生成」「查看原始响应」「存入资产库」
- [ ] **本次面板（右栏）**：每张图**右下角下载** + **图下方「复制」**；点图仍可放大；「下载全部」真下载
- [ ] **放大（lightbox）**：底部有「下载 / 复制」两键，均真生效
- [ ] **灵感卡点击放大**：点封面/卡片进 lightbox，放大后**标题/摘要/「用此提示词」悬浮在图上**（陶土按钮）；点「用此提示词」关闭并带回 Composer
- [ ] ⚠️ 真下载/复制依赖 Supabase 公桶 CORS（正常返 `*`）；若某图复制失败会 toast「请改用下载」（降级，不报错）

### Wave C 新能力（#3/#12/#9/#4）
- [ ] **#3 删会话**：左栏「最近」每条 hover 出**垃圾桶**键 → 二次确认「及其全部生成图永久删除」→ 确认后该会话消失；若正看着它则自动回新建态
- [ ] **#4 资产自定义日期**：`/assets` 选「自定义」→ 不再是原生 date input，而是**陶土风日历控件**（单月 + ‹›翻月 + 点起点→终点、区间高亮、越界灰禁、外点/ESC 关、清除）
- [ ] **#9 输出格式**：**保持只 png**（探测确认中转不透传 `output_format`、jpeg 仍返 PNG，故不放 jpeg 档，同 S6）——Composer 无格式药丸属预期
- [ ] **#12 后台删生成记录**：见 §4

### Wave D 大重构（#8/#11/#14）
- [ ] **#8 账号页**（`/account`）：**积分余额置顶卡**（+「N 积分将于 MM-DD 前过期」提示 + 去充值）→ **积分批次**表（来源[注册赠送/兑换充值/管理员调整]/发放/剩余/到期）→ **积分流水**（7 类型 Tab：全部/充值/消耗/赠送/退款/过期/调整，带 +/− 符号）→ **兑换记录**（脱敏码/到账/面值/有效期）→ 账号信息 → 改密 → 退出
- [ ] **#14 后台独立登录**：见 §4

## 4. 后台验收（/admin，需管理员）

两种建管理员方式（都双写 users.role + Better Auth user.role，即时生效）：

```bash
# A) 写死管理员（推荐，幂等）：.env 设 SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD（密码进 .env 不进 git），一条命令建号+提权
node --env-file=.env --import tsx scripts/seed-admin.ts

# B) 已有账号提权：先 /register 注册，再
node --env-file=.env --import tsx scripts/promote-admin.ts <你的邮箱>
```
> 🔑 凭据放 `.env`（已 gitignore），**绝不写进源码/提交**（密码进 git 历史=泄露）。新库流程：迁移 + seed → 跑 `seed-admin.ts`。
> 🆘 **后台自锁恢复**（如被封禁锁在外面）：`node --env-file=.env --import tsx scripts/unban.ts <email>`（清业务 `is_banned` + Better Auth `banned`）。注：管理员**不能封禁自己**（已加守卫，`setBanned` 400 + UI 本人行禁用），此脚本用于其它误封场景。

### #14 后台 UX 彻底分离（本轮新增）
- [ ] **后台登录走独立 `/admin/login`**（页面标「AI 图像工坊 · 后台」、无注册 Tab、按钮「登录后台」）；用管理员账号登录后**直达 `/admin`**
- [ ] 用**非 admin 账号**在 `/admin/login` 登录 → 报「该账号无后台权限」并自动登出（不进后台）
- [ ] **未登录**访问 `/admin` → 跳 `/admin/login`（不再是 `/login`）；**已登录非 admin** 访问 `/admin` → 跳 `/`（不暴露后台存在）
- [ ] 后台侧栏**无「返回工作台」入口**，底部只有「退出登录」→ 回 `/admin/login`（与用户端 UX 彻底分离，共用同一 Better Auth 账号体系）

### 各模块
- [ ] 用户管理 → **调积分弹窗填「积分」**（如 `0.07` / `-0.07`，不再填毫积分），下方提示「将充入/扣减 N 积分」（#11）
- [ ] 套餐 / 参数 → 全局参数里「**单价（积分/张）**」「**注册赠送（积分）**」显示 `0.07`/`0.14`（积分，非毫积分），改后保存即时生效；存回库仍是 mp（#11）
- [ ] **生成记录 → 可删除**（#12）：每行「删除」+ 勾选/全选后「删除选中（N）」→ 二次确认（「图片一并清理；已扣积分账本保留」）→ 删除后列表刷新；写操作审计 `delete_generation(s_batch)`
- [ ] 兑换码（批量发码/CSV 导出/作废/对账）、用户（搜索/详情/封禁/改密/调积分/调并发）、套餐、全局参数、灵感库 CRUD、数据看板、操作审计

## 5. 无界面验收（不开浏览器，对真后端跑脚本）

实施 Key 计划 Task 0 后，所有会写库的 smoke 都必须通过 `node --import tsx scripts/test-env-guard.ts scripts/<x>.ts`，只连接已确认的 disposable `.env.test`，再自建测试数据→断言→清理。禁止继续用 `node --env-file=.env` 对共享/生产候选库跑这些脚本；真实环境只执行 deploy runbook 明确列出的受控 smoke。

| 脚本 | 验什么 |
|---|---|
| `auth-smoke.ts` | 注册 → 送 140mp → 幂等 |
| `relay-smoke.ts` | **真中转生图** → Supabase → public_url 200 |
| `reads-smoke.ts` | 端到端：注册→送140→兑换→生成→详情/资产回流→存入→删除→限流（25 检查）|
| `deletes-smoke.ts` | **#3/#12 删除**：删会话级联+owner-scope、admin 删生成硬删+审计+账本保留、批删（18 检查）|
| `account-reads-smoke.ts` | **#8 账号页读**：lots 三来源 / ledger 类型筛 / redemptions / adjust 方向 / 余额自洽（17 检查）|
| `admin-smoke.ts` | 后台全套（发码/用户/调积分/套餐/灵感/看板/审计，27 检查）|
| `search-smoke.ts` | 搜索（owner-scoped/转义/ILIKE，13 检查）|
| `inspirations-smoke.ts` | **P3-S4 灵感运营化**（SQL 过滤/动态品类 DISTINCT/宽高回流/LIKE 转义/reorder 互换规整还原/上下架/红线无 storage_key，20 检查）|
| `relay-chat-probe.ts` | **中转 chat 模型探测**（P3-S6 前置）：列 `/models` + 试打候选 chat 模型。**当前中转只有 `gpt-image-2`、无 chat 模型 → S6 跳过**；中转开 chat 渠道后复跑确认模型名 |
| `relay-format-probe.ts` | **#9 中转 `output_format` 透传探测**（花 2 张图）：分别请求 png/jpeg 解码魔数。**实测中转不透传、jpeg 仍返 PNG → #9 只保留 png**；中转支持后复跑再做 |
| `cron-smoke.ts` | cron（超时重扫/过期/对账/清图/预算，27 检查，注入对象存储桩）|
| `db-verify.ts` / `db-smoke.ts` / `storage-smoke.ts` | 种子/迁移 / FOR UPDATE / 存储往返 |
| `npm run test:money` | 钱链路 33 例真库（并发/重入/幂等）|

> 迁移：灵感库表 `scripts/migrate-inspirations.ts`(0001) + 封面宽高列 `scripts/migrate-inspirations-dims.ts`(0002，P3-S4，幂等 `ADD COLUMN IF NOT EXISTS`)。

## 6. 验收须知

- **真生图花真钱**：每张走真中转（成本对账 0.07 定价的实测见 [cost-reconciliation.md](cost-reconciliation.md)，**毛利数待你灰度 ≥200 张跑量后填**）。验收少量即可。
- system/custom 生图都以创建后 **5 分钟 deadline** 兜底；**一旦开始不可取消**。
- 两种模式失败/超时都不扣费；system 成功按配置扣费，custom 成功固定零扣费。
- 阶段三 P3-S1（资产框选/长按）的**手势交互**建议在真浏览器点一遍（headless 难自动验）。
