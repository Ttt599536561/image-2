# AI 图像工坊 — 项目说明（CLAUDE.md）

> 本文件每次会话**自动加载**，是项目的"大脑"。新会话先读这里，再按需翻 docs。用中文沟通。

## 这是什么
一个**对话式（ChatGPT 风格）AI 生图网站**的重构项目：用户注册登录后，在 Composer 输入提示词生图，按**积分**计费，靠**兑换码**充值。v1 是已上线的双栏工具版，正重构为 v2。

## 当前阶段
**需求 + 低保真原型 + UI 视觉风格 + 技术选型 + 开发文档（技术设计文档）均已成稿**（多代理审查已做、5 条工程硬伤已修、13 条交互默认值已补，规格 §24）。UI 风格落 `docs/prototypes/design-system.html`（已同步进 §17）。**技术选型已锁定**（栈见下方「技术栈」节，§15 架构已同步、§14/§19 已据此修订预算熔断）。**开发文档已定稿** → `docs/dev/`（README 索引 + `00`–`11` 共 12 章），经三轮多代理审查收敛、**钱链路已签字**。**阶段一已全部完成**：slice 1（铁律④·修 v1 真后台 + 代理读 env key + 全链路删 apiKey）+ **前端形态主体**均已落地验证（vitest 42/42、typegen/tsc 0、build 通过、preview 逐态实测）。前端把 v1 双栏 SPA 重构为 **React Router 8 framework 模式（SSR）** 三栏壳：tokens 落 design-system + Composer 五态（宇宙星空动效）+ 6 档尺寸/高级药丸 + 灵感画廊一键带回 + cookie 明暗主题 + 全局 lightbox/toast；账号/积分全 mock，未接 Neon/Better Auth/R2。**注意栈用 RR8 不是 RR7**（RR7 仅支持 vite≤7，本仓 vite=8；RR8 framework 模式同构、原生支持 vite8；docs/dev 文中「RR7」即 framework 模式）。代码在 `phase1-frontend` 分支（仓库 `git init` 后，v1 基线在 `main`；worktree 工具因初始非 git 不可用）。**已经一轮多代理 QA 体检（39 项）+ 两轮站长走查反馈打磨并验收**（含 Apple HIG「在操作处反馈」：表单校验改内联、瞬时 toast 移顶部居中；vitest 45/45、tsc 0、build 通过）。**阶段一已快进合并进 `main`（`4f81022`）；阶段二施工计划已批准并落库** → [docs/dev/PHASE2-PLAN.md](docs/dev/PHASE2-PLAN.md)（7 阶段可勾选 + 钱链路红线 + 外部密钥 §0，基于 5 路多代理精读 02–11 综合）。**下一步：阶段二 ① 地基**（Neon 双连接 + Drizzle schema/迁移/seed + R2；schema/契约可离线先行、接真待站长开通 Neon+R2+密钥）；在 `main` 上开 `phase2` 分支推进。落地细节见 [docs/PROGRESS.md](docs/PROGRESS.md)「阶段一前端落地要点」。
- 进度 / 中断恢复看 → [docs/PROGRESS.md](docs/PROGRESS.md)
- **完整需求规格（唯一真相源）** → [docs/redesign-requirements.md](docs/redesign-requirements.md)

## 文档地图
- `docs/redesign-requirements.md` — **v2 完整产品规格**（页面/五态/积分/兑换码/后台/系统架构/数据库 schema/风险/分期）。读它就懂"要做什么"。
- `docs/PROGRESS.md` — 现在做到哪、下一步、未决项、上次若中断从哪接。
- `docs/prototypes/wireframes.html` — **全部页面/状态的低保真原型**（浏览器打开即看；研发照此开发**结构**）。`docs/prototypes/README.md` 是索引。
- `docs/prototypes/design-system.html` — **UI 视觉风格 / 设计令牌真相源**（明暗两套 + 全部 token + 组件样例；研发取色/间距/圆角一律引其 CSS 变量。结构看 wireframes、风格看这里、行为看规格）。
- `docs/dev/` — **v2 技术开发文档（研发照着写代码的蓝图）**：`README.md` 是索引 + 全局约定 + 4 铁律；`00`–`11` 共 12 章 + **`PHASE2-PLAN.md`（阶段二已批准的可执行施工清单：7 阶段可勾选 + 外部密钥 §0）**（栈/env·密钥、架构、DB DDL、钱链路、生图管线、鉴权、存储、API、前端、后台、cron·测试、目录·分期）。**怎么写代码看这里；要做什么看规格、长什么样看原型**。
- `docs/requirements.md`、`docs/development.md`、`docs/test-cases.md` — **v1 现状**（顶部都有 banner 指向 v2）。
- `docs/superpowers/` — 最早的 v1 计划/设计，历史存档，别改。

## 技术栈
- 现状(v1)：Vite + React 19 + TS；后端 Netlify Functions + Blobs，经"中转站"(One-API 风格 `https://api.tangguo.xin/v1`)异步代理生图 + 前端短轮询；Vitest。
- **v2 技术选型（已定稿，详见 §15 / 开发文档）**：部署 **Netlify**（演进现状；Background Functions 15min 跑 5min 生图、Scheduled Functions 跑 cron、阶段一 **DB-as-queue** 用 generations 状态机做队列，不引独立队列服务）；数据库 **Neon Postgres**（钱/码走 `@neondatabase/serverless` **Pool/WS** 交互式事务 + `FOR UPDATE`，看板走 HTTP；region 选 AWS 美东与 Netlify 函数同区）；ORM **Drizzle** + drizzle-kit；前端 **React Router 7 framework 模式** + Vite + React 19；鉴权 **Better Auth**（DB 可吊销会话 + admin 插件 + bcryptjs）；对象存储 **Cloudflare R2**（公有 bucket + 不可枚举 URL + 自定义域）；API 手写 REST(202+短轮询) + **TanStack Query v5** + **Zod4/drizzle-zod**；样式 tokens.css + CSS Modules；质量 Vitest+Playwright+**Biome**+Sentry+GitHub Actions。后台自建贴 design-system。**已排除** Next.js/TanStack Start、MySQL/PlanetScale、Supabase。
- **因「中转=同步阻塞」（用户拍板按最坏设计）4 条成本铁律**：① **单日预算熔断**（应用层硬上限，Netlify 无全局消费帽）② 上线前实测单图 GB-hour compute 成本对账 0.07 定价 ③ generations **抢占式状态机**(`UPDATE WHERE status='queued' RETURNING`)挡平台自动重试的重复扣费/重复下单 ④ 先修 generate.ts 真后台 + imageProxy.ts 阻塞 fetch 搬进后台读 env key。

## 关键产品决定（速查；细节以 redesign-requirements.md 为准）
- 对话式为唯一主范式（不做独立工作台）；模型**全站固定 `gpt-image-2`**；每次一张(`n=1`)。
- 必须**注册登录**（邮箱+密码、不验证邮箱）才能用；URL/Key **写死服务端环境变量**，前端碰不到。
- 计费：**1 积分=¥1**，**0.07 积分/张**，**成功才扣**，新号**注册即送 0.14**(=2张)；**积分不足 → 直接报错、不入队列、不扣费**；**积分按套餐设有效期(天/可永久)、过期作废、最早过期先扣(批次/lot 模型)**。
- 充值：兑换码（站长后台预生成、码一次性、可复购）；**充值套餐后台可配**（标题/价格/积分/有效期/URL，示例 ¥9.9→10 / ¥29.9→32 积分）；购买跳第三方店铺（URL 待给）；收入按**面值现金**记账。
- 图片保留期：免费 7 天 / 付费(兑过码) 60 天，到期 cron 自动清理；升级后旧图顺延 60 天。
- 并发：每用户默认 2、后台可调、超出报"超出并发数量"；任务 **5 分钟超时**兜底。
- 后台管理：兑换码、用户(封禁/改密/增减积分与并发,操作收「⋯」下拉)、灵感库 CRUD、**图片生成记录**(列表,失败直显报错+状态码,纯记录、不做收录)、**套餐管理 + 全局参数**、数据看板(含平均生图时长)、操作审计日志。生成**一旦开始不可取消**。
- **本期不做**：合规/内容审核（站长决定，风险自担）、图生图、一次多图、用户上传到资产库、订阅/真实支付、优化提示词(按钮占位)。
- Key 防护：① 单日消耗预算熔断（做）；② 中转独立子 Key（待确认中转是否支持）。

## 工程红线（钱不能错，详见 redesign-requirements.md §22）
积分用**整数毫积分**防浮点；扣费**落存储成功才扣 + `generation_id` 幂等键**；兑换码**原子核销**(`UPDATE ... WHERE status='active' RETURNING`)；并发计数终态正确释放。

## 现存待修
- ~~`generate.ts` 假后台 + 前端密钥链路~~ → **已修（阶段一 slice 1 / 铁律④）**：触发改 fire-and-forget 真后台、Key 只从 `process.env.RELAY_API_KEY` 注入、全链路删 apiKey、删前端密钥 UI（vitest 42/42、tsc 0）。
- job 态仍在 **Netlify Blobs**（§15 第一步暂留）——**阶段二**迁 `generations` 表（DB-as-queue + 抢占式状态机，见 docs/dev §5.7）。
- 死代码小尾巴：`src/api/imageGeneration.ts` 的直连 `generateImage`、`src/lib/curl.ts` 仍带 apiKey 参（应用不调用、无 Key 流经；§12.2 curl 可留 dev），要彻底清时再删。

## 工作约定
- **`docs/PROGRESS.md` 是状态唯一真相源**：顶部「里程碑总览」表(✅/🚧/⬜)一眼看进度。**每做完一项就当场标记**——翻里程碑状态、把「下一步」/「未决项」对应的 `[ ]` 改 `[x]`、必要时更新「当前状态」段与「最近更新」日期。状态**只在 PROGRESS 维护**，别散落进规格（规格只写"做什么"、不写"做没做"），免得多处漂移。
- 改完需求 / 做完一阶段，**务必更新 `docs/PROGRESS.md`**，让下个会话能接上。
- 跨会话/被中断后：先读 CLAUDE.md → PROGRESS.md → redesign-requirements.md，再动手。
