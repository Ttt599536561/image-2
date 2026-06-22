# AI 图像工坊 — 项目说明（CLAUDE.md）

> 本文件每次会话**自动加载**，是项目的"大脑"。新会话先读这里，再按需翻 docs。用中文沟通。
> 本节只留**当前态**（逐阶段历史在 [PROGRESS.md](docs/PROGRESS.md) + git log，别往这里堆，免得自动加载越来越胖）。

## 这是什么
一个**对话式（ChatGPT 风格）AI 生图网站**的重构项目：用户注册登录后，在 Composer 输入提示词生图，按**积分**计费，靠**兑换码**充值。v1 是已上线的双栏工具版，正重构为 v2。

## 当前阶段
**v2 主体已全部完成并合并进 `main`**（阶段一壳 + 阶段二接真后端 + 阶段三增强）：
- **阶段一**=对话式三栏壳 + Composer 五态（**RR8** framework/SSR，非 RR7；docs/dev 文中「RR7」即指此 framework 模式）。
- **阶段二**=Neon + Drizzle / Better Auth / Supabase Storage(S3) / **钱链路**（毫积分整数·成功才扣·`generation_id` 幂等·批次 FIFO·兑换原子核销·单日预算熔断）/ 生图管线（DB-as-queue + 抢占式状态机）/ 前端接真 / 后台 `/admin/*` / cron·可观测·CI。
- **阶段三**=资产框选(S1) + 搜索(S2) + 灵感库运营化(S4)。**S6 优化提示词跳过**——中转 `api.tangguo.xin` 只配 `gpt-image-2`、无任何 chat/文本模型（`scripts/relay-chat-probe.ts` 探测全 503），药丸保持 disabled 占位，中转开 chat 渠道后再做。**S3 RBAC / S5 客服 360 不做**（站长定·维持单管理员）。
- **✅ 站长本地验收 20 条改进——全部完成** → 追踪表 [docs/dev/PHASE3-FEEDBACK.md](docs/dev/PHASE3-FEEDBACK.md)。Wave A(8)`59a09c7` + B(图片操作 5)`5c1e5b8` + C(新能力/后端 4)`8aa24ec` + D(大重构 3)`af62860`。19 项实做 + **#9 输出格式探测否决跳过**（`scripts/relay-format-probe.ts` 实测中转不透传 `output_format`、jpeg 仍返 PNG，同 S6 范式，保持只 png）。4 决策已落（#9 实为探测后跳过、#8 账号页映射我们模型、#14 后台 UX 彻底分离、#12 删生成记录硬删+清 R2）。**下一步=站长本地 `netlify dev`(8888) 浏览器验收。**
- **🅿️ 待开发需求队列**（已入档、暂不动手，详见 [PROGRESS.md](docs/PROGRESS.md)「待开发需求队列」+ [redesign-requirements.md](docs/redesign-requirements.md) §9/§10）：① **后台通知配置/管理**（用户端铃铛已有、后台缺下发入口，现仅 cron 自动 `image_expiring`）；② **重命名会话**（左栏「最近」用户改名，契约 `RenameRequest` 已存在）。
- **本地运行**：`netlify dev`(8888，= `BETTER_AUTH_URL`)，**起前先 `rm -rf build .netlify`**、`[dev]` 不设 `framework`（否则无样式）；管理员 `599536561@qq.com` / `fefc8389`（凭据在 `.env`，`scripts/seed-admin.ts`）。**后台登录走独立 `/admin/login`（#14）**。⚠️ 本机 **Bash coreutils 偶发缺失（sleep/seq/tail 报 command not found）→ 跑 npm/长命令改用 PowerShell**。
- **测试基线**：tsc 0 · test:run 67 · build 0 · `assert-no-secrets` PASS · 对真 Neon smoke（reads/search/admin/cron/inspirations/**deletes/account-reads**）全绿。
- **分支**：`main`=最新；`phase1-frontend`/`phase2`/`phase3` 保留作里程碑；本地仓**无 remote、未 push**。
- **新会话接手顺序**：本文件 → [PROGRESS.md](docs/PROGRESS.md) 顶「🆕 新会话从这接手」→ [PHASE3-FEEDBACK.md](docs/dev/PHASE3-FEEDBACK.md)（当前主线）。**进度勾选只在 PROGRESS + PHASE3-FEEDBACK + PHASE2/3-PLAN**；规格/设计文档(00–11) 只写「做什么」不写「做没做」。

- 进度 / 中断恢复看 → [docs/PROGRESS.md](docs/PROGRESS.md)
- **完整需求规格（唯一真相源）** → [docs/redesign-requirements.md](docs/redesign-requirements.md)

## 文档地图
> 🧭 **按任务找文档（索引→详情）**：要做什么→`redesign-requirements.md`｜怎么写代码→`docs/dev/00–11`｜长什么样→`prototypes/`（结构 wireframes·风格 design-system）｜进度·接手·待开发→`PROGRESS.md`｜本地跑/逐条验收→`dev/local-acceptance.md`｜**红线提醒**（编辑钱/客户端/后台代码时按 `paths` 自动加载）→`.claude/rules/`。
- `docs/redesign-requirements.md` — **v2 完整产品规格**（页面/五态/积分/兑换码/后台/系统架构/数据库 schema/风险/分期）。读它就懂"要做什么"。
- `docs/PROGRESS.md` — 现在做到哪、下一步、未决项、上次若中断从哪接。
- `docs/prototypes/wireframes.html` — **全部页面/状态的低保真原型**（浏览器打开即看；研发照此开发**结构**）。`docs/prototypes/README.md` 是索引。
- `docs/prototypes/design-system.html` — **UI 视觉风格 / 设计令牌真相源**（明暗两套 + 全部 token + 组件样例；研发取色/间距/圆角一律引其 CSS 变量。结构看 wireframes、风格看这里、行为看规格）。
- `docs/dev/` — **v2 技术开发文档（研发照着写代码的蓝图）**：`README.md` 是索引 + 全局约定 + 4 铁律；`00`–`11` 共 12 章（栈/env·密钥、架构、DB DDL、钱链路、生图管线、鉴权、存储、API、前端、后台、cron·测试、目录·分期）+ **`PHASE2-PLAN.md`**（阶段二 ①–⑦ ✅）+ **`PHASE3-PLAN.md`**（阶段三 S1/S2/S4 ✅、S6 跳过、S3/S5 不做）+ **`PHASE3-FEEDBACK.md`（← 当前主线：验收 20 条追踪表）** + **`cost-reconciliation.md`**（成本对账上线闸·铁律②）+ **`local-acceptance.md`**（本地验收/运行指南 + 无界面 smoke 清单）。**怎么写代码看这里；要做什么看规格、长什么样看原型**。
- `docs/requirements.md`、`docs/development.md`、`docs/test-cases.md` — **v1 现状**（顶部都有 banner 指向 v2）。
- `docs/superpowers/` — 最早的 v1 计划/设计，历史存档，别改。
- `.claude/rules/` — **path-scoped 红线提醒**（按官方 memory 指南，编辑匹配代码时才自动加载，不占常驻上下文）：`money.md`（钱/管线）、`client-safety.md`（前端 0 密钥+0 schema）、`admin.md`（后台双守卫/审计/#14 分离）。各自指向权威 docs，是「编辑该区代码时必守的 5 条」而非真相源。

## 技术栈
- 现状(v1)：Vite + React 19 + TS；后端 Netlify Functions + Blobs，经"中转站"(One-API 风格 `https://api.tangguo.xin/v1`)异步代理生图 + 前端短轮询；Vitest。
- **v2 技术选型（已定稿，详见 §15 / 开发文档）**：部署 **Netlify**（Background Functions 15min 跑 5min 生图、Scheduled Functions 跑 cron、**DB-as-queue** 用 generations 状态机做队列，不引独立队列服务）；数据库 **Neon Postgres**（钱/码走 `@neondatabase/serverless` **Pool/WS** 交互式事务 + `FOR UPDATE`，看板走 HTTP）；ORM **Drizzle** + drizzle-kit；前端 **React Router 8 framework 模式** + Vite + React 19；鉴权 **Better Auth**（DB 可吊销会话 + admin 插件 + bcryptjs）；对象存储 **Supabase Storage**（S3 兼容公有桶 + 不可枚举 URL；代码厂商中立 `STORAGE_*`、走 `@aws-sdk/client-s3`；换 R2/B2/S3 只改 env）；API 手写 REST(202+短轮询) + **TanStack Query v5** + **Zod4/drizzle-zod**；样式 tokens.css + CSS Modules；质量 Vitest+Playwright+**Biome**+Sentry+GitHub Actions。后台自建贴 design-system。**已排除** Next.js/TanStack Start、MySQL/PlanetScale、Supabase 的 **DB/Auth**（DB 用 Neon、鉴权用 Better Auth；**但存储用 Supabase Storage**）。
- **因「中转=同步阻塞」（用户拍板按最坏设计）4 条成本铁律**：① **单日预算熔断**（应用层硬上限，Netlify 无全局消费帽）② 上线前实测单图 GB-hour compute 成本对账 0.07 定价 ③ generations **抢占式状态机**(`UPDATE WHERE status='queued' RETURNING`)挡平台自动重试的重复扣费/重复下单 ④ 已修 generate.ts 真后台 + 读 env key（阶段一）。

## 关键产品决定（速查；细节以 redesign-requirements.md 为准）
- 对话式为唯一主范式（不做独立工作台）；模型**全站固定 `gpt-image-2`**；每次一张(`n=1`)。
- 必须**注册登录**（邮箱+密码、不验证邮箱）才能用；URL/Key **写死服务端环境变量**，前端碰不到。
- 计费：**1 积分=¥1**，**0.07 积分/张**，**成功才扣**，新号**注册即送 0.14**(=2张)；**积分不足 → 直接报错、不入队列、不扣费**；**积分按套餐设有效期(天/可永久)、过期作废、最早过期先扣(批次/lot 模型)**。
- 充值：兑换码（站长后台预生成、码一次性、可复购）；**充值套餐后台可配**（标题/价格/积分/有效期/URL）；购买跳第三方店铺（**默认 `https://www.ldxp.cn/merchant/goods/list?is_proxy=0`**；常量 `src/lib/site.ts` `DEFAULT_PURCHASE_URL`，套餐 `redirect_url` 空即跳默认、后台可按套餐覆盖）；收入按**面值现金**记账。
- 图片保留期：免费 7 天 / 付费(兑过码) 60 天，到期 cron 自动清理；升级后旧图顺延 60 天。
- 并发：每用户默认 2、后台可调、超出报"超出并发数量"；任务 **5 分钟超时**兜底。
- 后台管理：兑换码、用户(封禁/改密/增减积分与并发,操作收「⋯」下拉)、灵感库 CRUD、**图片生成记录**(列表,失败直显报错+状态码,纯记录、不做收录)、**套餐管理 + 全局参数**、数据看板(含平均生图时长)、操作审计日志。生成**一旦开始不可取消**。
- **本期不做**：合规/内容审核（站长决定，风险自担）、图生图、一次多图、用户上传到资产库、订阅/真实支付、优化提示词(占位·中转无 chat 模型)。

## 工程红线（钱不能错，详见 redesign-requirements.md §22）
积分用**整数毫积分**防浮点；扣费**落存储成功才扣 + `generation_id` 幂等键**；兑换码**原子核销**(`UPDATE ... WHERE status='active' RETURNING`)；并发计数终态正确释放；客户端 **0 密钥 + 0 schema 泄露**（构建期 `assert-no-secrets` 兜底，客户端可达模块手写 Zod、绝不 value-import db/schema）。

## 工作约定
- **`docs/PROGRESS.md` 是状态唯一真相源**：顶部「里程碑总览」表(✅/🚧/⬜)一眼看进度。**每做完一项当场标记**——翻里程碑、改对应 `[ ]`→`[x]`、更新「当前状态」与日期。状态**只在 PROGRESS（+ PHASE3-FEEDBACK / PHASE2-3-PLAN）维护**，别散落进规格（规格只写"做什么"、不写"做没做"）。
- 做完一阶段/一波，**务必更新 PROGRESS**，让下个会话能接上。
- 跨会话/被中断后：先读 CLAUDE.md → PROGRESS.md → 当前主线追踪表，再动手。
- 死代码小尾巴（不挡事，彻底清时再删）：`src/api/imageGeneration.ts` 的直连 `generateImage`、`src/lib/curl.ts` 仍带 apiKey 参（应用不调用、无 Key 流经）。
