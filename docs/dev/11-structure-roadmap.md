# 12 · 目录结构 + 分期任务清单

> 把前 11 章的设计落成**一棵可建的目录树 + 一张 v1→v2 迁移台账 + 可勾选的分期任务清单 + 要装/要删的依赖**。研发起步时照此建工程、按阶段推进。
> 分期路线真相源：规格 [§20](../redesign-requirements.md)；与现有衔接 [§18](../redesign-requirements.md)。**进度状态只在 [PROGRESS.md](../PROGRESS.md) 维护，本章只列"要做什么"，不写"做没做"。**
> **2026-07-11 说明**：§12.2 中“删除 ApiConfig/localStorage/apiKey 链路”是 v1→v2 时删除无身份隔离的旧实现，仍是正确历史记录；新 custom 模式必须按 §12.6 的 user-scoped 本地配置 + 统一入口 + 任务级密文重新实现，不能复活旧链路。

## 12.1 目标 v2 目录结构

> 前端走 **React Router 8 framework 模式**，`app/routes.ts` 集中声明路由，loader/action 可直连 DB；显式 REST/Background/cron 走 `netlify/functions/*`。`src/server/*` 是 server-only 逻辑层（中转、对象存储、事务），RR8 编译边界与静态 secrets 断言共同防止进入客户端。

```
ai-image-workshop/
├─ app/                        # RR8 framework 模式根
│  ├─ root.tsx                 #   HTML 壳 + 全局 Provider（TanStack Query、主题、Toast）
│  ├─ routes.ts                #   集中路由表（声明全部路由模块，路由真相源 08 §9.2）
│  ├─ routes/                  #   路由文件（下划线 pathless 约定；loader/action = server 端，直连 DB 读余额/列表）
│  │  ├─ _app.tsx              #     登录后三栏壳（Composer 主范式，§9.2）
│  │  ├─ _app._index.tsx       #     新建生成 / 当前会话
│  │  ├─ _app.c.$id.tsx        #     某会话线程
│  │  ├─ _app.assets.tsx       #     资产库（/assets）
│  │  ├─ _app.inspiration.tsx  #     灵感库（/inspiration）
│  │  ├─ _app.account.tsx      #     账户 / 改密（/account）
│  │  ├─ _app.billing.tsx      #     充值页（套餐 + 兑换码）
│  │  ├─ _auth.login.tsx       #     登录（_auth pathless 布局）
│  │  ├─ _auth.register.tsx    #     注册
│  │  ├─ _auth.forgot.tsx      #     忘记密码
│  │  ├─ api.inspiration-submissions.ts       # 灵感库 UGC：POST 投稿 / GET 我的投稿（requireUserStrict，不扣积分，见 INSPIRATION-UGC-PLAN.md）
│  │  ├─ api.admin.inspiration-submissions.ts # 后台投稿：GET 队列 / POST 审核（requireAdmin，同上）
│  │  ├─ _admin.inspiration-submissions.tsx   # 后台「灵感投稿」队列页（状态筛 Tab + 通过/驳回，§10.1）
│  │  └─ _admin.*.tsx          #     其余后台（独立 _admin 布局，RBAC=admin，§10.1）
│  └─ entry.server.tsx / entry.client.tsx
│
├─ src/
│  ├─ db/
│  │  ├─ schema.ts             # Drizzle schema，逐列对齐 02 §3.2 DDL（部分唯一索引人工核对；含 notifications 表，02 §3.2）
│  │  ├─ db.server.ts          # ★server-only：neon() HTTP（看板/只读）+ Pool/WS（钱事务）两种连接工厂（00 §1.3）
│  │  └─ seed.ts               # 种子：admin / 默认 packages / app_config 默认值（02 §3.5）
│  ├─ contracts/              # Zod4 + drizzle-zod，前后端单一真相源（07 §8.5）
│  │  ├─ generate.ts          #   提交/状态/列表 请求·响应 schema
│  │  ├─ redeem.ts            #   兑换 请求·响应·错误码
│  │  ├─ inspirationSubmission.ts #  灵感库 UGC 投稿/我的投稿/审核 schema（client-safe 手写 Zod，见 INSPIRATION-UGC-PLAN.md）
│  │  └─ admin.ts             #   后台各端点 schema（含投稿审核 SubmissionReviewAction）
│  ├─ server/                 # ★只在服务端运行的纯逻辑层（无 React、被 functions + loader 共用；文件统一 *.server.ts，编译期剔除前端 bundle）
│  │  ├─ relay/               #   中转代理：调用 + 响应解析（复用 v1 imageGeneration.ts）+ 脱敏 + 失败归一化
│  │  ├─ r2.server.ts         #   对象存储上传/删除（历史文件名）+ 灵感投稿副本复制（buildInspirationSubmissionKey/copyToInspirationSubmission，07 章）
│  │  ├─ inspirationSubmissions.server.ts # 灵感库 UGC 投稿：submitInspiration（限流/上限/归属/去重/复制副本/事务）+ listMySubmissions（见 INSPIRATION-UGC-PLAN.md）
│  │  ├─ money/               #   钱事务封装：扣费/兑换/注册发放/过期/对账（03 章 SQL 落 TS）
│  │  ├─ admin/              #   后台服务端逻辑（双守卫 + 审计同事务）
│  │  │  └─ inspirationReview.server.ts #  投稿审核：listSubmissions/countPendingSubmissions/approveSubmission/rejectSubmission（建上架卡+署名+通知，见 INSPIRATION-UGC-PLAN.md）
│  │  ├─ tx.server.ts        #   tx() 事务助手（开 client→BEGIN→…→COMMIT/ROLLBACK→release，00 §1.3）
│  │  ├─ budget.server.ts    #   单日预算熔断读写（铁律①，04 §5.6）
│  │  └─ auth.server.ts      #   Better Auth 实例 + admin 鉴权守卫（05 章）
│  ├─ components/            # 复用组件（Composer 五态 / 尺寸药丸 / 资产网格 / Toast，§9.6）
│  ├─ hooks/                 # TanStack Query hooks（余额 / job 短轮询 / 列表，§9.3）
│  ├─ lib/                   # 跨端纯工具：redaction.ts（复用）/ 金额换算 mp↔小数 / 格式化 / publicHandle.ts（投稿署名掩码昵称 qk***，见 INSPIRATION-UGC-PLAN.md）
│  └─ styles/
│     └─ tokens.css          # 从 design-system.html 落地的设计令牌（明暗两套，§9.5）
│
├─ netlify/
│  └─ functions/
│     ├─ generate.ts                 # 同步：入队双闸（余额/并发/预算）+ INSERT queued + 触发后台（04 §5.2）
│     ├─ generate-background.ts      # ★Background(15min)：抢占→调中转→落R2→扣费事务（04 §5.3）
│     ├─ generate-status.ts          # 同步：短轮询查 generations（04 §5.4）
│     ├─ redeem.ts                   # 同步：兑换核销事务（04 §4.7 / 07 §8.4）
│     ├─ notifications.ts            # 同步：站内通知读写（GET 未读列表 + POST 标记已读，07 §8.3 / F-notif）
│     ├─ admin/                      # 后台 API（码/用户/套餐/灵感/记录/看板，10 章；全部 admin 守卫）
│     │  ├─ codes.ts / users.ts / packages.ts / inspirations.ts / generations.ts / dashboard.ts / config.ts
│     ├─ auth.ts                     # Better Auth handler（catch-all，05 §6.1）
│     ├─ scheduled-timeout-sweep.ts  # cron：5min 超时重扫（10 §11.6）
│     ├─ scheduled-expire-credits.ts # cron：积分过期（10 §11.2）
│     ├─ scheduled-clean-images.ts   # cron：保留期清理（06 §7.5 / 10 §11.7）
│     ├─ scheduled-reconcile.ts      # cron：余额对账（10 §11.3）
│     └─ scheduled-budget-cleanup.ts # cron：清理/归档旧预算键 + 近阈告警（当日键 date-in-key 自动归零，10 §11.8）
│
├─ drizzle/                   # drizzle-kit 生成的迁移 SQL（入库；部分唯一索引人工核对，02 §3.4）
│  └─ 0004_inspiration_submissions.sql # 灵感库 UGC：建 inspiration_submissions 表 + inspirations 加 submitted_by/submitter_name（见 INSPIRATION-UGC-PLAN.md）
├─ scripts/
│  ├─ assert-no-secrets-in-bundle.ts # ★构建期断言：扫 dist/ 不含任何密钥（00 §1.4，CI 拦截）
│  ├─ inspiration-submissions-smoke.ts # 灵感库 UGC 真 Neon 冒烟（投稿/去重/越权/审核建卡署名+通知/重投/唯一索引兜底）
│  └─ migrate-inspiration-submissions.ts # 应用 0004 迁移
├─ tests/
│  ├─ money/                  # 钱链路事务测试（对真 Neon 分支库，含并发双击/重试重入，10 §11.10）
│  └─ e2e/                    # Playwright 冒烟（登录→生图→兑换，10 §11.10）
├─ netlify.toml               # 函数运行时 + Scheduled cron 表 + build 命令
├─ drizzle.config.ts          # drizzle-kit 配置（schema 路径 / Neon 连接 / out=drizzle/）
├─ biome.json                 # Biome lint/format 配置
├─ vite.config.ts             # plugins:[reactRouter(), netlifyReactRouter()]（@react-router/dev + @netlify/vite-plugin-react-router；08 §9.1）
├─ vitest.config.ts / playwright.config.ts
└─ package.json
```

**关键目录职责一句话**：

| 目录/文件 | 职责 |
|---|---|
| `app/routes.ts` | 集中路由表，声明全部路由模块（路由真相源，[§9.2](08-frontend.md)） |
| `app/routes` | RR8 路由树；loader/action 跑在服务端，直连 DB 读余额/列表（[§9.1](08-frontend.md)） |
| `src/db/schema.ts` | Drizzle schema，逐列对齐 [02 §3.2](02-database.md)；钱的部分唯一索引人工核对 |
| `src/contracts` | Zod 请求/响应契约，前后端复用（[07 §8.5](07-api.md)） |
| `src/server`（`*.server.ts`） | 服务端纯逻辑：中转代理 / 对象存储 / 钱事务封装 / 预算 / 鉴权守卫（被 functions+loader 共用；`*.server.ts` 编译期剔除前端 bundle，[§9.1](08-frontend.md)） |
| `src/styles/tokens.css` | design-system.html 落地的设计令牌（[§9.5](08-frontend.md)） |
| `netlify/functions` | 显式 REST + Background + Scheduled 端点（[07 §8.3](07-api.md) / [10 §11.1](10-ops-test.md)） |
| `drizzle/` | 迁移 SQL 真相源（[02 §3.5](02-database.md)）；部分唯一索引 `WHERE` 谓词人工核对（[02 §3.4](02-database.md)） |
| `scripts/assert-no-secrets-in-bundle.ts` | 防密钥进 bundle 的构建期断言（[00 §1.4](00-overview.md)） |

## 12.2 v1 迁移清单（现状文件 → 处置 → 去向）

> 衔接策略真相源 [§18](../redesign-requirements.md)；密钥全链路移除细节见 [00-overview.md §1.4](00-overview.md) 与 [04-generation-pipeline.md §5.7](04-generation-pipeline.md)。

| 现状文件 | 处置 | 去向 / 改法 |
|---|---|---|
| `src/components/GeneratorForm.tsx` | **复用（拆分）** | 尺寸选择器（`SIZE_OPTIONS` 6 档）抽进 Composer 尺寸药丸；质量/背景/审核进高级设置（[§9.4](08-frontend.md)） |
| `src/api/imageGeneration.ts` | **复用** | 中转响应解析逻辑搬 `src/server/relay/`；**删请求体里的 apiKey** |
| `src/lib/redaction.ts`(+test) | **复用** | 搬 `src/lib/`，所有回前端的中转报错先过脱敏（[00 §1.4](00-overview.md)） |
| `src/server/imageProxy.ts` | **v1 历史重构** | 删除无身份隔离的 `input.apiKey`；system Key 攥回服务端。新 custom 不复活该字段，走 §12.6 |
| `src/server/asyncImageJob.ts` | **重构** | 异步代理骨架保留思路；`JobRecord`（status/时间/原始 response）→ **`generations` 表**，补 userId/model/size/duration/失败原因（[02 §3.2](02-database.md)） |
| `src/server/jobStore.ts`（Netlify Blobs） | **删除** | job 态改以 `generations` 表为准（Blobs 是 KV、最终一致、无原子操作；[01 §2.1](01-architecture.md)） |
| `netlify/functions/generate.ts` | **重构** | 现状用 `fetch` 主动调后台 = 假后台、会超时 → 改真后台触发 + 入队双闸（[§5.2](04-generation-pipeline.md) / [§5.7](04-generation-pipeline.md)） |
| `netlify/functions/generate-background.ts` | **重构** | 加抢占式状态机（[03 §4.5](03-money.md)）+ 落对象存储 + 扣费事务（[03 §4.3](03-money.md)）+ 读 env key |
| `netlify/functions/generate-status.ts` | **重构** | 查 `generations` 表（非 Blobs）；返回 status + 成功 `public_url` / 失败 error+code（[§5.4](04-generation-pipeline.md)） |
| `src/App.tsx` | **重构** | 双栏工具版 → Composer **三栏壳**（左会话 / 中对话 / 右本次面板，[§9.2](08-frontend.md)） |
| `src/components/ApiConfigModal.tsx` | **v1 历史删除** | 删除未按用户隔离的旧密钥 UI；新弹窗按 §12.6 另建 |
| `src/hooks/useApiConfig.ts` | **v1 历史删除** | 删除全局 localStorage/apiKey 上送链路；新 helper 必须 user-scoped、只上送统一 endpoint |
| `src/api/proxyGeneration.ts`(+test) | **重构** | 删 POST body 里的 apiKey；前端只发 `{prompt,size,quality,background}`（[07 §8.5](07-api.md)） |
| `src/components/ResultPanel.tsx` | **复用（重构）** | 结果展示并入 Composer 成功态 + 本次面板（[§9.4](08-frontend.md)） |
| `src/lib/validation.ts` `curl.ts` `storage.ts` | **酌情** | 校验逻辑迁 `src/contracts`（Zod）；curl 调试件可留 dev；storage（localStorage 草稿）保留与否看 §9 |
| `src/styles.css` | **重构** | 拆成 `src/styles/tokens.css`（令牌）+ CSS Modules（[§9.5](08-frontend.md)） |

> **v1 全链路删 apiKey 红线**：旧 `imageProxy → proxyGeneration → jobStore` 明文链路永久禁止。2026-07-11 custom 例外仅允许 user-scoped localStorage → HTTPS 统一提交 → generation-scoped 密文；Background payload 与普通 generation 字段仍不传 Key。详见 [04-generation-pipeline.md §5.9](04-generation-pipeline.md)。

## 12.3 分期任务清单（可勾选）

> 与规格 [§20](../redesign-requirements.md) 对齐。每项链到对应 dev 章节。**勾选状态在 [PROGRESS.md](../PROGRESS.md) 维护，此处仅作任务分解蓝图。**
>
> **路线收尾状态**：v2 已上线生产（Netlify，<https://ai-image-workshop-612.netlify.app>，2026-06-22；生产=本地同一 Neon 库），部署 runbook 见 [deploy.md](deploy.md)。

### 阶段一 · 前端形态 + 修现存隐患（mock 账号/积分跑通体验）

- [ ] 建 RR8 framework 模式工程骨架 + `tokens.css` 从 design-system.html 落地（[§9.1](08-frontend.md) / [§9.5](08-frontend.md)）
- [ ] App.tsx 双栏 → Composer 三栏壳 + 五态（[§9.2](08-frontend.md) / [§9.4](08-frontend.md)）
- [ ] 尺寸/参数药丸 + 高级设置（复用 GeneratorForm 的 `SIZE_OPTIONS`，[§12.2](#122-v1-迁移清单现状文件--处置--去向)）
- [ ] 灵感画廊静态版 + 深色/暖色主题切换（[§9.5](08-frontend.md)）
- [ ] **修 `generate.ts` 为真 Background Function**（删假 fetch 触发，[§5.7](04-generation-pipeline.md)）
- [ ] **代理读 env key**：`imageProxy.ts` 删 `apiKey` 字段，Key 从 `process.env.RELAY_API_KEY` 注入（[00 §1.4](00-overview.md) / [§5.7](04-generation-pipeline.md)）
- [ ] generate-status 查表骨架 + 前端 5min 短轮询（mock 数据，[§5.4](04-generation-pipeline.md)）

### 阶段二 · 账号 + 积分 + 存储（公开上线前必需）

**地基**
- [ ] 接 Neon：`src/db/db.server.ts` 两种连接（HTTP + Pool/WS），跑通 `FOR UPDATE`（[00 §1.3](00-overview.md)）
- [ ] Drizzle schema + 迁移：建全部业务表 + 索引 + **部分唯一索引人工核对**（[02 §3.2](02-database.md)/[§3.3](02-database.md)/[§3.5](02-database.md)）
- [ ] 种子数据：admin / 默认 packages / app_config（[02 §3.5](02-database.md)）
- [ ] 接 Supabase Storage S3：沿用历史名 `src/server/r2.server.ts` 上传/删除 + `public_url` 拼接，配置用 `STORAGE_*`（[06 §7.1](06-storage.md)）

**鉴权**
- [ ] Better Auth：email+password + admin 插件 + bcryptjs + 业务 `users` 对齐（[05 §6.1](05-auth.md)/[§6.2](05-auth.md)）
- [ ] 会话 DB 硬校验 + 封禁/改密即时失效 + 密码限长防 bcrypt 截断（[05 §6.3](05-auth.md)/[§6.4](05-auth.md)/[§6.5](05-auth.md)）
- [ ] 注册原子发放 0.14 钩子（`uq_grant_signup` 幂等，[03 §4.4](03-money.md) / [05 §6.6](05-auth.md)）

**钱链路（§22 工程一致性，命门）**
- [ ] 积分账本 + 批次模型（FIFO + 过期，[03 §4.1](03-money.md)/[§4.8](03-money.md)）
- [ ] 入队双闸：余额(402) + 并发(409) + 预算熔断(429)（[03 §4.9](03-money.md)）
- [ ] 抢占式状态机 `UPDATE…WHERE status='queued' RETURNING`（铁律③，[03 §4.5](03-money.md)）
- [ ] 成功才扣单事务（先对象存储后扣费，`uq_debit` 幂等，[03 §4.3](03-money.md)）
- [ ] 兑换码核销事务 + 错误码 404/410/400/429（[03 §4.7](03-money.md) / [07 §8.4](07-api.md)）
- [ ] 单日预算熔断（应用层硬上限，铁律①，[04 §5.6](04-generation-pipeline.md)）

**生图管线**
- [ ] DB-as-queue 全链路打通：submit→background→status（[04 §5.1](04-generation-pipeline.md)~[§5.4](04-generation-pipeline.md)）
- [ ] system 基线：5min cron 重扫 + 七值失败归一化；当前目标按 §12.6 改为 `deadline_at` 共用收口，system 七值不回归、custom 十值精确分类、读取取并集
- [ ] v1 代码迁移：删 apiKey 链路 / jobStore→generations（[04 §5.7](04-generation-pipeline.md) / [§12.2](#122-v1-迁移清单现状文件--处置--去向)）

**前端业务页**
- [ ] 充值页：套餐展示 + 兑换框 + 过期 tooltip（[§9.2](08-frontend.md)）
- [ ] 历史会话 / 资产库 / 本次对话面板 + 并发提示（[§9.4](08-frontend.md)/[§9.6](08-frontend.md)）
- [ ] 余额/job 态/列表统一走 TanStack Query（[§9.3](08-frontend.md)）

**后台管理**
- [ ] 兑换码管理（批量预生成 + 作废，[10 §10.2](09-admin.md)）
- [ ] 用户管理（封禁/改密/增减积分与并发，[10 §10.3](09-admin.md)）
- [ ] 灵感库 CRUD（[10 §10.4](09-admin.md)）
- [ ] 生成记录列表（失败直显报错+状态码，[10 §10.5](09-admin.md)）
- [ ] 套餐 + 全局参数 + 审计日志（二次确认，[10 §10.6](09-admin.md)）
- [ ] 数据看板（含平均生图时长，[10 §10.7](09-admin.md)）

**cron / 可观测 / 测试**
- [ ] 5 个 Scheduled：超时重扫 / 过期 / 清理 / 对账 / 旧预算键清理（[10 §11.1](10-ops-test.md)~[§11.8](10-ops-test.md)）
- [ ] GB-hour 成本实测对账 0.07 定价（铁律②，[10 §11.5](10-ops-test.md)）
- [ ] 可观测/告警接入 Sentry + ADMIN_ALERT_WEBHOOK（[10 §11.9](10-ops-test.md)）
- [ ] 钱链路对真 Neon 分支库跑事务测试 + Playwright 冒烟 + CI（[10 §11.10](10-ops-test.md)）
- [ ] 构建期密钥断言 `assert-no-secrets-in-bundle.ts` 挂 CI（[00 §1.4](00-overview.md)）

### 阶段三 · 增强（✅ 收官并合并 `main`；施工清单/状态以 [PHASE3-PLAN.md](PHASE3-PLAN.md) + [PROGRESS.md](../PROGRESS.md) 为准）

- [x] **P3-S2 搜索**（会话标题 + 资产提示词，owner-scoped ILIKE + 转义 + debounce）
- [x] **P3-S1 资产库高级管理**：自定义日期区间 / 桌面框选 + 移动长按多选 / zip 导出 / 过期角标（[§9](08-frontend.md)，规格 §24.8/9）
- [x] **P3-S4 灵感库运营化**：category/q 下沉 SQL + 动态品类 DISTINCT + 瀑布流宽高回填（新增 `inspirations.width/height`）+ 后台上下移/上下架（[07 §8.3](07-api.md)/[09 §10.4](09-admin.md)）
- 🚫 **P3-S6 优化提示词**：本期跳过——中转 `api.tangguo.xin` 只配 `gpt-image-2`、无 chat/文本模型（[PHASE3-PLAN §6](PHASE3-PLAN.md)）；药丸保持占位，中转开 chat 渠道后再做
- 🚫 **P3-S3 RBAC / P3-S5 客服 360**：本期不做（站长：维持单管理员）
- **灵感库用户投稿与审核（UGC）**：新需求（规格 [§13.1](../redesign-requirements.md)）——用户从作品投稿 → `inspiration_submissions(pending)` → 后台审核通过上架/驳回 + 站内通知，不扣积分；详细设计/落地见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)
- [ ] （更远）图生图 / 一次多图 / 单图编辑 / 订阅与真实支付（本期明确不做，规格 §21）
- [ ] （规模化）DB-as-queue → 独立 worker + Redis/BullMQ 或 QStash，`generations` 状态机不变（[01 §2.5](01-architecture.md)）

## 12.4 依赖清单

> 当前实际版本以 `package.json` 为准：React 19、Vite 8、React Router 8、TypeScript、Vitest 等。

### dependencies（生产）

| 包 | 用途 | 引自 |
|---|---|---|
| `react-router` `@react-router/node` `isbot` | RR8 framework 模式运行/SSR 配套 | [08 §9.1](08-frontend.md) |
| `drizzle-orm` | ORM / schema | [02 §3.4](02-database.md) |
| `@neondatabase/serverless` | Neon 驱动（HTTP + Pool/WS） | [00 §1.3](00-overview.md) |
| `ws` | Node 运行时注入 WebSocket 给 Neon Pool | [00 §1.3](00-overview.md) |
| `better-auth` | 鉴权（admin 插件；Drizzle adapter 为 better-auth 内置，无需额外包） | [05 §6.1](05-auth.md) |
| `bcryptjs` | 密码哈希（Better Auth 配套） | [05 §6.4](05-auth.md) |
| `@aws-sdk/client-s3` | 当前 Supabase Storage S3 兼容上传/删除 | [06 §7.1](06-storage.md) |
| `@tanstack/react-query` | 查询缓存 + 短轮询 | [08 §9.3](08-frontend.md) |
| `zod` | 契约校验（Zod 4） | [07 §8.5](07-api.md) |
| `drizzle-zod` | 由 schema 推 Zod，前后端单一真相源 | [07 §8.5](07-api.md) |
| `@sentry/node` | 服务端错误上报 | [10 §11.9](10-ops-test.md) |
| `@sentry/react` | 前端错误上报（可选） | [10 §11.9](10-ops-test.md) |

### devDependencies（开发/构建/CI）

| 包 | 用途 | 引自 |
|---|---|---|
| `@react-router/dev` | RR8 framework 模式构建/路由约定 | [08 §9.1](08-frontend.md) |
| `@netlify/vite-plugin-react-router` | Netlify 跑 RR8 framework 模式的 Vite 插件 | [08 §9.1](08-frontend.md) |
| `drizzle-kit` | 迁移生成/应用 | [02 §3.5](02-database.md) |
| `@biomejs/biome` | lint + format | [00 §1.1](00-overview.md) |
| `@playwright/test` | E2E 冒烟 | [10 §11.10](10-ops-test.md) |
| `@types/ws` `@types/bcryptjs` | 类型 | — |
| `tsx`（或 `ts-node`） | 跑 `scripts/*.ts`、seed、断言脚本 | [00 §1.4](00-overview.md) |

### 待删 / 评估

| 包 | 处置 |
|---|---|
| `@netlify/blobs` | **job 态迁 `generations` 表后即可删**（[§12.2](#122-v1-迁移清单现状文件--处置--去向)）；若无其他 KV 用途则从 deps 移除 |

> **依赖红线**：Neon、`STORAGE_*`、Better Auth secret、`RELAY_*` 与任务加密主密钥只在 server 侧；`assert-no-secrets-in-bundle.ts` 在 CI 兜底。

## 12.5 落地红线清单

- [ ] 工程统一一套路由根（`app/routes` 或 `src/routes`，二选一不混用），路由模块走下划线 pathless 约定并在 `app/routes.ts` 集中声明（[08 §9.2](08-frontend.md)）。
- [ ] 服务端纯逻辑统一 `*.server.ts` 后缀，靠 RR8 server-only 边界与构建期断言阻止密钥进入客户端（[08 §9.1](08-frontend.md)）。
- [ ] `netlify/functions` 里生图后台触发真 Background 二者其一：`-background` 文件名后缀，**或**（Functions v2）函数内 `export const config = { background: true }`；官方推荐后者，后缀仍受支持（[00 §1.2](00-overview.md)）。
- [ ] Scheduled 函数全部在 `netlify.toml` 配 cron（[10 §11.1](10-ops-test.md)）。
- [ ] Drizzle 迁移生成后**人工核对** `drizzle/*.sql` 含部分唯一索引的 `WHERE` 谓词（[02 §3.4](02-database.md)）。
- [ ] v1 迁移期间删旧 apiKey 链路一处不漏；新 custom 例外只按 [04 §5.9](04-generation-pipeline.md) 进入统一请求并立即转 generation-scoped 密文，后台 payload 不携 Key。
- [ ] 阶段推进按 §12.3 顺序：地基→鉴权→钱链路→管线→页面→后台→cron/测试；钱链路上线前必须对真库跑事务测试（[10 §11.10](10-ops-test.md)）。

## 12.6 当前功能目标结构（2026-07-11）

逐步施工以 [实施计划](../superpowers/plans/2026-07-11-user-api-key-modes.md) 为准；预期新增/修改边界如下：

```text
src/
├─ lib/userApiConfig.ts                         # user-scoped localStorage，纯客户端
├─ components/shell/ApiKeyModal.tsx             # system/custom 单选与 Key 输入
├─ components/shell/TopBar.tsx                  # KeyRound 入口
├─ contracts/generate.ts                        # credentialMode/customApiKey + 批量状态
├─ server/relay.ts                              # 同一 callRelay，显式 credential context
└─ server/generation/
   ├─ credential.server.ts                     # AES-GCM 加解密/取用/终态删除
   ├─ enqueue.ts                               # system/custom 原子分流
   ├─ finalizeCustom.server.ts                 # custom 零扣费成功事务
   ├─ deadline.server.ts                       # status/cron 共用原子收口
   └─ process.server.ts                        # 按 mode 解析凭据
netlify/functions/
├─ generate.ts                                 # 唯一提交端点
├─ generate-background.ts                      # 只接 generationId
├─ generate-status.ts                          # 单 ID 兼容 + 批量查询
└─ cron-clean-generation-credentials.ts        # 10min TTL + 5min cron，正常最迟 15min
drizzle/
└─ 0005_user_generation_credentials.sql         # mode/deadline/credential 表
```

约束：

- 尽量沿用仓库现有文件名；实施前以 `rg --files` 确认真实路径。计划中的新 helper 只有在能隔离密钥/事务或消除真实重复时才建立。
- 不新增 `/api/generate/custom`、第二个 relay client、第二套图片存储或用户级服务端 custom Key 配置表。
- 加密使用 Node `crypto`/Web Crypto 标准能力，不为 AES-GCM 新增第三方依赖。`CUSTOM_KEY_JOB_ENCRYPTION_KEY` 仅在实现/部署时加入 env 模板。
- 新增测试紧邻现有契约、生成、钱、cron 和组件测试；必须对真 Neon 验 system/custom 事务分流，对浏览器做本地配置/多任务可视验收。
- 完成功能后再更新 [PROGRESS.md](../PROGRESS.md) 状态、测试基线与生产提交；本章不提前勾成已完成。
