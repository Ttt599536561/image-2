# v2 技术开发文档（技术设计文档）

> 这是 **研发照着写代码的蓝图**。它把已锁定的技术选型 + 产品规格落成可执行的工程设计。
> **真相源分工**：要做什么看 [redesign-requirements.md](../redesign-requirements.md)（产品规格，唯一产品真相源）；长什么样看 [wireframes.html](../prototypes/wireframes.html)（结构）+ [design-system.html](../prototypes/design-system.html)（视觉令牌）；**怎么写代码看本文件夹**。
> 进度/状态只在 [PROGRESS.md](../PROGRESS.md) 维护，本文件夹**不写"做没做"**（避免多处漂移）。

> **2026-07-11 目标契约覆盖说明**：当前待实施功能以 [批准版 PRD](../../tasks/prd-user-api-key-modes.md) 和 [实施计划](../superpowers/plans/2026-07-11-user-api-key-modes.md) 为准。00–11 章中旧的“前端不收任何 Key”“所有生成都过余额/预算/并发闸”“cron 才是 5 分钟权威收口”等文字描述 system-only 历史基线；与新增章节冲突时，以各章的 2026-07-11 增补为准。生产是否完成只看 [PROGRESS.md](../PROGRESS.md)。

## 阅读顺序

新会话/新成员按此顺序读：

1. [当前功能 PRD](../../tasks/prd-user-api-key-modes.md) + [实施计划](../superpowers/plans/2026-07-11-user-api-key-modes.md) — 先锁定已批准边界和施工顺序
2. [00-overview.md](00-overview.md) — **技术栈总览 + 环境变量/密钥/配置**（先建立全局认知 + 把密钥红线刻进脑子）
3. [01-architecture.md](01-architecture.md) — 系统架构：组件图 + 三大流程时序（生图 / 扣费 / 兑换）
4. [02-database.md](02-database.md) — 数据库设计：完整 DDL + 索引 + 部分唯一索引 + Drizzle 映射 + 迁移策略
5. [03-money.md](03-money.md) — **钱/积分链路（核心，最详）**：可执行事务步骤 + 幂等键 + 抢占式状态机
6. [04-generation-pipeline.md](04-generation-pipeline.md) — 生图管线：submit→后台→短轮询 + 5min 超时 + 预算熔断 + **v1 代码迁移**
7. [05-auth.md](05-auth.md) — 鉴权与会话：Better Auth + 封禁/改密硬校验
8. [06-storage.md](06-storage.md) — 对象存储与媒体：R2 + 清理 cron
9. [07-api.md](07-api.md) — API 契约：端点 + 状态码（402/409/410/429）+ Zod
10. [08-frontend.md](08-frontend.md) — 前端架构：RR7 路由表 + TanStack Query + tokens 落地
11. [09-admin.md](09-admin.md) — 后台管理
12. [10-ops-test.md](10-ops-test.md) — cron / 可观测 / 测试
13. [11-structure-roadmap.md](11-structure-roadmap.md) — 目录结构 + 分期任务清单（可勾选）+ v1 迁移清单
14. [deploy.md](deploy.md) — **生产部署 Netlify runbook**（怎么上线 / 部署步骤 + 生产现状〔已上线 https://ai-image-workshop-612.netlify.app，生产=本地同一 Neon 库〕+ 运维待办）

> 📌 **施工计划（落地顺序/任务/外部依赖；00–11 是设计真相源）**：
> - **[2026-07-11-user-api-key-modes.md](../superpowers/plans/2026-07-11-user-api-key-modes.md) — 当前待实施功能计划**：系统/自定义 Key、临时凭据、多任务状态、统一 deadline。
> - **[PHASE2-PLAN.md](PHASE2-PLAN.md) — 阶段二「账号+积分+存储」✅ 已完成并合并 `main`**（①–⑦ 全勾，对真 Neon 验证）。
> - **[PHASE3-PLAN.md](PHASE3-PLAN.md) — 阶段三「增强」✅ 收官并合并 `main`**（`51f2b0b` 快进）：P3-S1 框选 + P3-S2 搜索 + P3-S4 灵感运营化 已做；**P3-S6 优化提示词跳过**（中转无 chat 模型，§6）；S3 RBAC/S5 客服 360 不做（站长：维持单管理员）。
> - **[cost-reconciliation.md](cost-reconciliation.md) — 成本对账上线闸（铁律②）**：方法论 + 对账表占位（真·毛利数待上线灰度跑量后填，毛利>0 才放量）。
> - **[local-acceptance.md](local-acceptance.md) — 本地验收/运行指南**：`netlify dev`(8888) 跑通注册→登录→生图→兑换→后台的人工验收手册 + 无界面 smoke 清单。
> - **[deploy.md](deploy.md) — 生产部署 Netlify runbook（怎么上线）**：Netlify CLI 部署步骤 + 生产现状（已上线 https://ai-image-workshop-612.netlify.app，生产=本地同一 Neon 库）+ 运维待办。

## 全文档共享约定（任何章节都默认遵守，不再重复声明）

- **金额一律整数**：积分用**毫积分（milliPoints）BIGINT**（`1 积分 = 1000 mp`，`0.07 积分 = 70 mp`）；现金用**分 BIGINT**（`¥9.9 = 990`）。**绝不用 float / NUMERIC**。变量/列名带 `_mp` 后缀表毫积分、`_cash` 表分。
- **生成状态机**：`generations.status ∈ {queued, claimed, running, succeeded, failed}`。in-flight（并发计数口径）= `{queued, claimed, running}`。
- **账本条目类型**：`credit_ledger.entry_type ∈ {grant, credit, debit, refund, expire, adjust}`。
- **一个 `generation_id` 贯穿全链路**：提交 → 生图 → 落图 → 扣费，是幂等主键。
- **模型固定** `gpt-image-2`；每次 `n=1`；审核固定 `moderation=low`。
- **DB 调用模式区分**：钱/码的**多语句事务**走 `@neondatabase/serverless` 的 **Pool/WebSocket + `FOR UPDATE`**；兑换核销等**单语句 `UPDATE…RETURNING`** 与看板只读聚合走 **HTTP**。
- **密钥红线**：系统/基础设施秘密（`RELAY_API_KEY`、数据库、存储、鉴权密钥）只在服务端且永不进 bundle。custom Key 是批准的受控例外：按 user ID 明文存浏览器，只经 HTTPS `/api/generate` 上送，服务端只保存任务级密文；不得进入 bundle、普通表字段、日志、错误或响应（详见 [00-overview.md](00-overview.md) §1.4）。
- **术语**：milliPoints=毫积分；lot=积分批次（`credit_lots` 行）；relay=中转（`api.tangguo.xin`，OneAPI 风格、**同步阻塞、无 webhook**）。

## 4 条成本铁律（因「中转 = 同步阻塞」，贯穿全文档）

| # | 铁律 | 落在 |
|---|---|---|
| ① | system 保留**单日预算熔断**；custom 明确绕过预算/余额/并发/提交限流，平台成本风险已接受 | [04](04-generation-pipeline.md) §5.6、§5.9 / [10](10-ops-test.md) |
| ② | 上线前**实测单图 GB-hour compute 成本**对账 0.07 定价 | [10](10-ops-test.md) §11.5 |
| ③ | generations **抢占式状态机** `UPDATE…WHERE status='queued' RETURNING` 防平台重试重复扣费/下单 | [03](03-money.md) §4.5 / [04](04-generation-pipeline.md) §5.3 |
| ④ | **先修** `generate.ts` 真后台 + `imageProxy.ts` 阻塞 fetch 搬后台读 env key | [04](04-generation-pipeline.md) §5.7 / [11](11-structure-roadmap.md) |

## 维护

技术设计若变更：改对应章节文件 + 在 [PROGRESS.md](../PROGRESS.md) 记一笔。产品规则变更先改 [redesign-requirements.md](../redesign-requirements.md)，本文档随后对齐。
