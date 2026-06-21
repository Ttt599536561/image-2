# 进度与交接（PROGRESS.md）

> 每次有实质进展就更新这里。新会话 / 中断恢复：先读 [CLAUDE.md](../CLAUDE.md) → 本文件 → [redesign-requirements.md](redesign-requirements.md)，再动手。
> 最近更新：2026-06-21。

## 里程碑总览
> 图例：✅ 完成 · 🚧 进行中 · ⬜ 未开始。**这是状态的一眼速查；每做完一项当场翻状态 + 同步下方「当前状态」段。**

| # | 里程碑 | 状态 |
|---|---|---|
| 1 | 需求规格（redesign-requirements.md） | ✅ 定稿 |
| 2 | 低保真原型（wireframes.html，21 节含 6 二级页） | ✅ 定稿 |
| 3 | UI 视觉风格（design-system.html） | ✅ 定稿 |
| 4 | 技术选型 | ✅ 定稿 |
| 5 | **开发文档（技术设计文档）** | ✅ 定稿（docs/dev/，12 章；钱链路已签字） |
| 6 | 阶段一 · 前端形态 | ✅ 完成（RR8 骨架 + 三栏壳 + 五态 + 灵感画廊 + 主题，mock 跑通并验证） |
| 7 | 阶段二 · 账号+积分+存储 | ⬜ 未开始 ← **下一步** |
| 8 | 阶段三 · 增强 | ⬜ 未开始 |

## 当前状态
**需求 + 低保真原型（含 6 个二级页）+ UI 视觉风格 + 技术选型 + 开发文档（技术设计文档）均已定稿。** UI 风格落 `docs/prototypes/design-system.html`（同步进 §17）；二级页线框补齐进 `wireframes.html`（共 21 节）；**技术选型已锁定**（见下方独立条目）；**开发文档已定稿** → `docs/dev/`（README 索引 + `00`–`11` 共 12 章），经**三轮**多代理审查（① 起草+对抗校验 → ② 单一真相源裁决修订 + 全局终审 → ③ 正确性/完整性对抗审查，3 blocker + 一批 major 全修）跨章口径收敛一致；**钱链路（03/04）已逐条向站长导读并签字**（成功才扣的慢图代价 D、预算软/硬闸过冲 E/F、callRelay 软超时+主备 Base G、adjust 红线 H 均经确认）。**阶段一已全部完成**：slice 1（铁律④·修 v1 真后台 + 代理读 env key + 全链路删 apiKey）+ **前端形态主体均已落地并验证**。前端形态主体把 v1 双栏 SPA 重构为 **React Router 8 framework 模式（SSR）** 的对话式三栏壳：`tokens.css` 落地 design-system（明/暗 + 不反相 `--cosmic-*`）；侧栏(nav+最近) ｜ 对话+Composer ｜ 「本次·N」面板（≥1024 常驻/<1024 抽屉/<768 折叠）；**Composer 五态**（欢迎/生成中=宇宙星空动效+`生成中 M:SS`/成功=成品图+5 操作/失败=504+未扣已退+重试/积分不足=拦截去充值）；尺寸 6 档 + 高级设置（质量/背景）药丸；灵感画廊（封面瀑布流+一键带回）；深色/暖色 cookie 主题（SSR 无闪烁）；全局 Lightbox/Toast/Skeleton；次级页 mock 占位（/billing 做实兑换）。**账号/积分全 mock**，未接 Neon/Better Auth/R2（阶段二）。**验证**：vitest 42/42、`react-router typegen && tsc` 0、`react-router build` 通过；preview 工具逐态实测（提交→星空→成功扣 0.07、失败未扣、积分不足拦截→/billing、兑换 +10「积分到账」、主题切换、lightbox、灵感带回均通过）。**git 隔离**：环境非 git 仓库且 worktree 工具不可用 → 改用 `git init` + `main`(v1 基线 8667d04) + `phase1-frontend` 分支隔离。**下一步：阶段二**（账号+积分+存储；地基→鉴权→钱链路→管线→页面→后台→cron/测试）。**新对话从读 CLAUDE.md → 本文件 → docs/dev 接手。**

> **阶段一前端落地要点（研发须知）**：① **栈用 RR8 不是 RR7**——RR7(7.x) 仅支持 vite≤7，而本仓 vite 已是 8.0.11（v1 42 测试基线），RR8.0.1 的 framework 模式与 RR7 同构（loader/action/SSR/`routes.ts`/`+types`/`react-router.config.ts`），且原生支持 vite 8，故用 RR8 + `@netlify/vite-plugin-react-router@4`（React 钉到 19.2.7 满足 RR8 peer）；docs/dev 文中「RR7」即指 framework 模式，版本以此为准。② **vitest 与 RR 插件分离**：`vitest.config.ts` 只挂 `@vitejs/plugin-react`，不加 `reactRouter()`（同时加载冲突）。③ **目录**：`app/`(root+routes+路由模块) + `src/`(components/hooks/lib/mocks/contracts/styles/server)，与 11 §12.1 一致；mock 客户端态在 `src/mocks/store.tsx`(MockProvider)，job 轮询 hook 在 `src/hooks/`。④ **短轮询 `refetchIntervalInBackground:true`**（比 08 §9.3 示例的 false 更贴合「提交后切走等结果」，且修复隐藏标签页不轮询）。⑤ 删了 v1 SPA 入口（index.html/main.tsx/App.tsx/styles.css/GeneratorForm/ResultPanel）；`src/lib/storage.ts` **保留**（`imageProxy.ts` 仍依赖其 `DEFAULT_API_CONFIG`，阶段二随真生成链路再清模型 localStorage 残留）。⑥ preview 截图工具对 vite dev（HMR 长连不 idle）超时，故用 snapshot + eval 驱动逐态验证。⑦ **已做一轮多代理 QA 体检（39 项）并修复**：尺寸浮层改向下弹（欢迎态不再遮标题）+ 选项内描边环零回流不溢出、充值套餐卡可点选中（陶土环，默认推荐档）、灵感跨路由带回走受控 gating、抽屉/弹窗统一锁背景滚动 + ESC、本次面板 <768 底部抽屉、三栏列改 CSS 门控消除水合闪烁、z-index 统一令牌（toast 恒在 lightbox 上）、通知铃铛改占位、删 storage 死代码（保留 DEFAULT_API_CONFIG）等；唯一驳回：放宽兑换码正则（dev 文档锁 18 位去 I/L/O，现状已符）。vitest 45/45。⑧ **两轮站长走查反馈已并入并验收**：尺寸浮层向下弹（欢迎态不遮标题）+ 选项内描边环、充值套餐卡可点选中、账号信息改**只读「标签+值」横排**（非输入框、邮箱不断词）、高级设置选完即关浮层（与尺寸一致）、灵感「用此提示词」不再弹「替换当前输入?」、删演示码提示；并按 **Apple HIG「在用户操作处反馈」**把表单校验（改密/兑换）从右上角 toast 改为**表单内联**、瞬时 toast 从右上角移到**顶部居中**。vitest 45/45、tsc 0、build 通过、preview 逐项实测。

## 已完成
- v1 文档对齐了实际实现（development / requirements / test-cases，顶部加了指向 v2 的 banner）。
- v1 尺寸选择器已优化为「按用途」场景卡片（已落在 v1 代码：`src/components/GeneratorForm.tsx` + `src/styles.css`，61 个测试通过）。
- v2 完整需求规格成稿：`docs/redesign-requirements.md`（页面/五态/积分/兑换码/后台/系统架构/数据库 schema/工程一致性/风险/分期路线）。
- **全部页面/组件/状态低保真原型已产出**（登录/注册、对话页各态、高级设置展开、本次对话图片面板、放大预览、充值页、资产库、灵感库、后台各模块），并按用户反馈修正：模型固定 `gpt-image-2`（去模型药丸）、高级设置只留质量/背景（审核固定宽松）、图片审核改**列表**、放大预览=**屏幕居中 lightbox**、资产库精简操作、工作态补回完整导航等。
  - **原型已存为文件**：`docs/prototypes/wireframes.html`（浏览器打开看全部页面/状态）+ `docs/prototypes/README.md`（索引，每页映射到规格章节）。研发照此开发结构、行为看规格。
- 又一轮反馈已并入规格 + 原型：**生成不可取消**（去取消/已取消态）、放大预览只下载、资产库**日期分组+日期筛选器**、用户操作收「⋯」下拉、配置中心改**套餐管理+全局参数**、图片审核改名**图片生成记录**（纯记录、失败直显报错+状态码、不做收录）、灵感库改为站长手动维护、**积分有效期（每套餐可配、含「永久」、批次/FIFO/过期清零）**。
- **跑了一轮多代理全面审查**（需求/原型/记忆/代码，27 条），据此修了 **5 条工程硬伤**：金额定死毫积分 BIGINT、扣费事务按"批次/FIFO/行锁"写成可执行步骤 + 合法部分唯一索引 DDL、**全链路删 apiKey**、并发计数用 `COUNT(进行中)`、补 `audit_log`/`events` 表 + 二级索引（§15/§16/§22）。钱的规则也定：赠送 30 天有效期、FIFO、不做子 Key 与全站预算熔断、并发"入队前判断+成功行锁扣减不出负"。
  - 审查发现的 **13 条交互默认值已补进规格 §24**（注册错误/忘记密码占位、列表分页空态、兑换码错误码、过期提醒、存入资产库、本次面板网格、日期筛选、批量多选、一键带回、Toast 规范、骨架、后台参数校验等）。
  - 当时仍待补的几个二级页原型 → **现已补齐**（见下方独立条目）。
- 建立长期记忆机制：本文件 + `CLAUDE.md` + 项目 memory。
- **UI 视觉风格已定稿确认**：产出 `docs/prototypes/design-system.html`（v2 设计令牌真相源，亮色默认/暗色可切、柔和现代、系统字体栈、陶土 `#C26A3D` 点缀；明暗两套 + 12 节组件样例）。用户确认的关键决策：① 亮色默认 ② 柔和现代（卡片 16/输入 12/药丸·按钮 full） ③ 系统字体栈 ④ 主操作暗色反相为浅底 ⑤ **生成中占位 = 宇宙星空动效**（跑了 4 方案设计赛选出「深空银河·旋转极光」+ 嫁接强化） ⑥ **灵感卡改封面为主体 + 渐变浮层 + 瀑布流保留原比例**。已同步进规格 §17，并据④的"套餐描述"诉求给 `packages` 表补 `description` 字段（§16/§9）。
- **二级页线框已补齐**（`wireframes.html` 第 16–21 节，全文件共 21 节）：用户详情（概要+操作栏、积分流水、积分批次、最近生成、调积分弹窗）、灵感卡新增/编辑表单、生成兑换码弹窗、账号设置、删除确认弹窗（全站通用确认范式）、忘记密码占位页。低保真灰块、复用现有 class、经一致性评审（h2 编号统一为「N.」、弹窗统一「遮罩内 flex 居中」范式）。**至此全部页面/状态线框齐备。**
- **技术选型已定稿确认**（跑了 8 方向并行深研 + 架构师综合 + 对抗评审）。**锁定栈**：部署 Netlify（演进现状，Background Functions 15min 承载 5min 生图、Scheduled Functions 跑 cron、阶段一 DB-as-queue）；数据库 **Neon Postgres**（钱/码走 `@neondatabase/serverless` Pool/WS 交互式事务 + `FOR UPDATE`，看板走 HTTP）；ORM **Drizzle**+drizzle-kit（关键幂等约束手写校对 SQL）；前端 **React Router 7 framework 模式**+Vite+React 19；鉴权 **Better Auth**（DB 可吊销会话+admin 插件+bcryptjs，钉版避 multi-session CVE）；存储 **R2 公有 bucket+不可枚举 URL+自定义域**；API 手写 REST(202+短轮询)+**TanStack Query v5**+**Zod4/drizzle-zod**（`src/contracts`）；样式 tokens.css+CSS Modules；质量 Vitest(真 Neon 分支测钱链路)+Playwright 冒烟+**Biome**+Sentry+GitHub Actions。后台自建贴 design-system（不引 Refine）。**已排除**：Next.js/TanStack Start、MySQL/PlanetScale（缺部分唯一索引+RETURNING、serverless 生态弱）、Supabase（鉴权/存储已另选、多带不用的）。
  - **因「中转 api.tangguo.xin = 同步阻塞」升级为铁律（用户已拍板按最坏设计）**：① **单日预算熔断**（应用层硬上限，Netlify 无全局消费帽 → 这同时澄清 CLAUDE.md① vs §14/§19 的不一致：**确认做「单日中转/compute 预算熔断」**）；② 上线前实测单图 GB-hour compute 成本对账 0.07 积分确认毛利；③ generations **抢占式状态机**（`claimed/processing` + `UPDATE WHERE status='queued' RETURNING`）挡平台自动重试/cron 重扫的重复扣费/重复下单；④ 先修现存硬伤 generate.ts 真后台 + imageProxy.ts 阻塞 fetch 搬进后台读 env key。
  - **开发文档需定清的遗留**：Neon direct vs pooled endpoint（压测验证 FOR UPDATE 真锁不撞 max_connections）；Better Auth 封禁/改密敏感路径每请求查 DB 硬校验（不走 cookieCache 300s 窗口）+ 密码限长防 bcrypt 72 字节截断；毫积分跨 JSON（单笔 number、看板 SUM 走 string codec）；构建期断言 env(apiKey/baseUrl) 永不进前端 bundle。
  - 完整选型分析存盘：会话工作流输出（架构师综合 + 对抗评审）。
- **开发文档（技术设计文档）成稿**：落 `docs/dev/`（拆文件结构，README 索引 + `00-overview`/`01-architecture`/`02-database`/`03-money`/`04-generation-pipeline`/`05-auth`/`06-storage`/`07-api`/`08-frontend`/`09-admin`/`10-ops-test`/`11-structure-roadmap` 共 12 章；文件 `NN-name.md` 对应标题 `(NN+1) ·`）。其中 00–03 由更早会话写就，本次补齐 04–11 八章并做一致性收敛。
  - **流程**：① 多代理工作流并行起草 04–11（各章先读 README+00–03+规格再落笔）+ 逐章对抗校验（锚点齐全/交叉引用不断链/全局约定一致/不与规格矛盾）；② 据校验把跨章冲突收敛成「单一真相源裁决」（D1–D29），亲手修已定稿的 02/03 + 工作流按裁决精修 04–11 + 全局终审复核；③ 收敛核验确认关键 token 全统一。
  - **裁决落定的跨章口径**（研发须知）：失败模型 = `generations.error_code`(归一化六值枚举:insufficient_quota/relay_5xx/provider_timeout/content_rejected/relay_unreachable/unknown) + `error`(脱敏人读) + `http_status`；`generate-status` 响应 = 按 status 判别联合三态（04 §5.4 ↔ 07 §8.5 逐字段一致）；`putToR2(userId,generationId,relayImage)` / `retentionExpiry(user,cfg)` 签名以 06 为准；`credit_lots.source` 加 `adjust`；单日预算计数 = `app_config` 的 date-in-key（`relay_budget:${YYYY-MM-DD}`、字段 calls/ms、calls 调中转前+1/ms 调后累加、读闸在入队事务内 client c）；`users.id` 去 DB default、恒由注册 hook 写 Better Auth 的 UUID；Better Auth 会话硬校验走其 API（不裸查 session 表）；兑换码字母表 `REDEEM_ALPHABET`(31 字符) 前后端单一真相源；僵尸 claimed 用 `COALESCE(started_at,updated_at)` 兜底。
  - **第三轮：正确性 + 完整性对抗审查**（6 维度并行评审 12 章终态 + 逐条对抗核实滤假阳性）。坐实并已修：**3 个 blocker**——① 扣费事务重构为「⓪ 双守卫（锁 generation 行断言 running + 探 debit）」一举防住"重入重复扣 lots"与"超时翻 failed 后仍扣钱"（违背成功才扣）；② `EXTRACT(MILLISECONDS…)` 是 PG 陷阱（只返回秒分量、≥1min 截断）→ 全改 `(EXTRACT(EPOCH…)*1000)::int`；③ 单日预算「软闸/硬上限」分离——硬上限做成与递增同一原子条件 `UPDATE…WHERE calls<阈值 RETURNING`（防 TOCTOU 击穿）。**major**：补站内通知整链（`notifications` 表 + 清理 cron 过期前 1 天预扫 + `/api/notifications` 端点 + 顶栏铃铛 UI）；`/api/me` 增 `expiringSoon` 字段（积分过期实时提示数据源）；`callRelay` 补 AbortController 软超时 + 主/备 Base + 退避重试；bcrypt 72 字节在 `password.hash` 内强制断言（Better Auth 的 maxPasswordLength 只按字符）；Better Auth `generateId:'uuid'`（原生 uuid 列可建外键）；RR7 依赖补 `@netlify/vite-plugin-react-router`。**minor/nit**：FK `ON DELETE RESTRICT`、FIFO 索引加 created_at、429 归一化、触发 fire-and-forget + queued 兜底、孤儿账号登录惰性补发等。**money-3（adjust 调积分）已落实**：09 §10.3 加红线——adjust 必同事务改 `credit_lots`(增建批次/减 FIFO 扣) + 物化余额（否则对账 cron 以 lots 为准会反转调整）；并修两处真 bug——减额账本/事件记**真扣量 moved**(非请求量)、增/减分别记 `credit_granted`/`credit_consumed`(不再都记发放、污染看板口径)。

- **阶段一 slice 1（铁律④）已落地并验证**：第一段 v2 真代码。`imageProxy.ts` 从 `process.env.RELAY_API_KEY`/`RELAY_BASE_URL` 注入（缺 Key 返 500）；`ImageProxyInput` 删 apiKey/baseUrl；`generate.ts` 触发改 fire-and-forget + 本地 URL 回退；前端删密钥 UI（删 `ApiConfigModal.tsx`/`useApiConfig.ts`、`storage.ts` 去 apiKey 存取、`proxyGeneration` 只发 `{request}`）。**保留 Blobs job 态、未上 Neon**（§15 第一步）。验证：`vitest 42/42`、`tsc -b 0`、grep 确认真实 app 路径无 apiKey。残留小尾巴：死代码 `generateImage`(直连)/`curl.ts` 仍带 apiKey 参（应用不调用、§12.2 curl 可留 dev），无 Key 流经应用。

## 下一步（按顺序；做完把 `[ ]` 改 `[x]` + 翻里程碑总览）
- [x] **编写开发文档（技术设计文档）** → 已成稿 `docs/dev/`（README + `00`–`11` 共 12 章）：技术栈/env·密钥红线、系统架构（组件图+生图/扣费/兑换三时序）、数据库 DDL+索引+5 部分唯一索引、钱链路事务（可执行 SQL+幂等键+抢占式状态机）、生图管线（含 5min 双层超时+单日预算熔断+v1 迁移）、鉴权（Better Auth+封禁/改密硬校验）、R2 存储+清理 cron、API 契约（状态码+Zod 判别联合）、前端架构（RR7 路由表+TanStack+tokens）、后台管理、cron/可观测/测试、目录结构+分期清单。经两轮多代理审查收敛跨章口径（失败模型/函数签名/枚举/预算计数/路由命名等一致）。
- [x] **阶段一·前端形态**（✅ 完成）：
  - [x] **铁律④·修真后台 + 读 env key + 全链路删 apiKey**（§15 第一步，保留 Blobs、未上 Neon）：`imageProxy.ts` 从 `process.env.RELAY_API_KEY`/`RELAY_BASE_URL` 注入（缺 Key 返 500）；`ImageProxyInput` 删 apiKey/baseUrl；`generate.ts` 触发改 fire-and-forget + 本地 URL 回退；前端删密钥 UI（删 `ApiConfigModal.tsx`/`useApiConfig.ts`、`storage.ts` 去掉 apiKey 存取、`proxyGeneration` 只发 `{request}`）。**验证：vitest 42/42 通过 + `tsc -b` 0**。残留小尾巴：死代码 `generateImage`(直连)/`curl.ts` 仍带 apiKey 参（应用不调用、§12.2 curl 可留），无 Key 流经应用。
  - [x] 前端形态主体：**RR8** framework 骨架（非 RR7，vite8 兼容，见上「落地要点」①）+ `tokens.css` 落地 + App.tsx 双栏→Composer 三栏壳 + 五态（宇宙星空动效）+ 尺寸/参数药丸 + 灵感画廊 + 深色/暖色（mock 账号/积分跑通体验）。**验证 vitest 42/42 + typegen/tsc 0 + build 通过 + preview 逐态实测**。隔离用 `phase1-frontend` 分支（worktree 工具因仓库非 git 不可用）。
- [ ] **阶段二·账号+积分+存储**：注册登录 + Neon + R2 + 队列 + 积分账本 + 扣费 + 兑换码 + 充值页 + 后台 + 历史/资产库/本次面板 + 并发 + 工程一致性(§22)。
- [ ] **阶段三·增强**：搜索、资产库高级管理、客服/RBAC、优化提示词；（更远）图生图、多图、单图编辑。

## 未决项 / 待确认（不阻塞起步；解决了打 `[x]`）
- [ ] 中转 api.tangguo.xin 是否支持**独立子 Key**（Key 防护②）。
- [ ] 中转是否支持**请求级幂等键**（防平台重试对中转重复下单）。
- [ ] Neon **direct vs pooled endpoint**（开发文档压并发验证 `FOR UPDATE` 真锁、不撞 max_connections）。
- [ ] **单图 GB-hour compute 成本实测**（上线前对账 0.07 积分定价确认毛利）。
- [ ] 第三方店铺**购买 URL**（用户后续提供，前期占位）。
- [x] ~~单日预算熔断是否做~~ → **已定：做**（应用层硬上限，§14/§15/§22）。
- [x] ~~中转接口同步/异步~~ → **已定：同步阻塞**（按最坏设计 + 4 条成本铁律兜底）。

## 易错点 / 红线
- 钱相关一致性：redesign-requirements.md §22（毫积分整数、落盘才扣、`generation_id` 幂等、兑换码原子核销、并发计数终态释放、余额对账）。
- 合规/内容审核**本期不做**（站长决定，风险自担，§21 有存档）。
- 模型固定 `gpt-image-2`；每次 `n=1`。
