# CLAUDE.md

> 当前项目上下文快照。这里只保留接手开发所需的当前事实；历史过程与测试数字统一归档在 [docs/PROGRESS.md](docs/PROGRESS.md) 和 Git。

## 项目

这是一个对话式 AI 生图网站：用户登录后在 Composer 提交文生图或图生图任务，system 模式按积分成功扣费，图片落 Supabase Storage 并进入会话与资产库，后台负责配置、运营与审计。

## 已核验快照（2026-07-11 本地实现）

- 当前工作分支：`codex/user-api-key-modes`，本地功能提交 `0d48d90`，本地生成链路修复 `1fd083c` + 单进程启动收口 `ad258ac`。
- 起始实现基线为 `34969f59e2ef07909009bd163dc4dbe64d5fb5b0`；当前分支已包含 UGC 文档事实与 Key 模式实现。
- 当前生产仍是代码 `42d8a0b` / Netlify deploy `6a3aa2bd`，已包含 UGC；本地 Key 模式代码尚未部署生产。
- Key 模式、多任务状态、统一 deadline、加密临时凭据、后台展示与回滚脚本已在本地实现并通过验证；生产仍保持 system-only。
- 本地验证基线：单元测试 188/188、金额测试 74/74、类型检查、构建、敏感信息扫描、Playwright 6 通过 / 1 个旧 smoke 安全跳过。手工生图只用 `npm run dev:netlify:test`；`dev:ui:test` 仅供 mock E2E。
- 安全前置仍有效：跟踪文档曾误含真实管理员凭据，当前文本必须保持脱敏；实际管理员密码轮换与现有会话吊销仍需站长执行。任何消息、日志、示例或提交不得复述旧值。

## 生产部署前硬门禁

本地实现完成不等于生产发布。上线前必须全部满足：

1. 完成管理员密码轮换与会话吊销；若仓库会共享，再单独决定是否清理 Git 历史。
2. 在生产维护窗口应用 `0005`，确认存量 system 数据、deadline 回填和凭据表为空。
3. 设置主密钥并以 `CUSTOM_KEY_MODES_ENABLED=false` 暗部署完整版本，验证 system 回归与 custom 503/零写入。
4. 运行受控 production smoke、审计日志/普通表/观测系统脱敏检查，再启用 custom；不得拆散迁移、API、worker、零扣费事务、状态收口、UI 和回滚脚本。

## 真相源层级

- v2 基线产品契约：[docs/redesign-requirements.md](docs/redesign-requirements.md)。
- 当前批准增量：[tasks/prd-user-api-key-modes.md](tasks/prd-user-api-key-modes.md)；与基线 §25 冲突时，本 PRD 优先。
- 实施顺序与验证命令：[docs/superpowers/plans/2026-07-11-user-api-key-modes.md](docs/superpowers/plans/2026-07-11-user-api-key-modes.md)。
- 人工状态台账：[docs/PROGRESS.md](docs/PROGRESS.md)。
- 已实现/已部署的事实证据：Git 分支/提交、数据库迁移记录、测试原始输出和 Netlify production deploy。
- 技术章节索引：[docs/dev/README.md](docs/dev/README.md)。历史 PHASE 文件不再充当当前状态入口。

## 当前批准增量速查

- system/custom 共用 `POST /api/generate`、同一 generation 状态机、同一 relay 构造与同一存储结果链路；禁止第二个 custom 生图端点。
- custom Base URL 固定为 `https://api.tangguo.xin/v1`。用户 Key 按 user ID 明文存在当前浏览器，经 HTTPS 随每次生成提交；这是明确接受的风险，不得宣传为端到端加密。
- 服务端只保存 generation-scoped AES-GCM 密文；终态立即删除。TTL/过期判断使用数据库时钟：孤儿 TTL 10 分钟、cleanup 每 5 分钟，正常调度下物理清理不得晚于创建后 15 分钟。
- system 保留余额、FIFO 成功扣费、系统日预算和 system-only 并发口径；custom 不查本站余额、不扣积分、不计 system 预算/并发、不做生成提交限流，也不自动回退 system。
- custom 允许连续多任务；system 保持当前单项进行中交互。一个轮询控制器按每批 `<=50` 分片追踪；连续 `missingIds` 经权威刷新仍缺失时显示 UI-only“任务不存在或无权访问”，不伪造服务端终态。
- generation 权威 deadline 为服务端创建时间 + 5 分钟；状态读取与 cron 原子收口，成功与超时只能一个终态生效。
- “不扣积分”只指本站积分；用户自定义 Key 的第三方计费由服务商规则决定。
- system/custom 实际 Key 都必须在 relay 边界先脱敏；Key 不得进入普通 DB 字段、events、audit、日志、Sentry 或用户/admin 响应。
- custom 有缺省关闭的 server-side kill switch；关闭必须 503/零写入且不能静默改走 system，已打开页面收到 503 后也要立即进入暂停 UI。紧急回滚先关入口，再用受审计脚本收口在途任务和清凭据；凭据/非终态清零前不得删除或轮换主密钥。

## 当前实现基线

- 已实现：文生图、图生图、乐观立即跳转、system/custom 双模式、user-scoped 浏览器配置、AES-GCM generation-scoped 凭据、custom 零扣费事务、批量状态轮询、统一 `deadline_at`、后台生成记录、回滚脚本、Supabase Storage、灵感运营与 UGC。
- system 保持余额/预算/并发/成功扣费；custom 连续多任务不查本站余额、不占 system 并发/预算，并在 relay 边界脱敏。
- `src/api/imageGeneration.ts` 的浏览器直连函数和 `src/lib/curl.ts` 的旧 apiKey 参数仍是未被业务调用的历史尾巴，不得重新接入。

## 技术栈

- React Router 8 framework/SSR + React 19 + Vite 8 + TypeScript。
- TanStack Query v5 + Zod 4 / drizzle-zod。
- Neon Postgres + Drizzle；钱/码事务使用 Pool/WS + `FOR UPDATE`。
- Better Auth。
- Supabase Storage 的 S3 接口，环境变量统一 `STORAGE_*`；`r2.server.ts` / `putToR2` 只是历史函数名。
- Netlify Functions、Background Functions、Scheduled Functions；DB-as-queue 使用 generations 抢占式状态机。
- Vitest、真库 money tests、Playwright、构建期 secrets 断言。

## 工程红线

- 金额一律整数毫积分；system 成功才扣，`generation_id` 幂等，批次 FIFO，余额不得为负。
- system 并发只统计 `credential_mode='system'` 的 in-flight；custom 任务不得占用 system 并发额度。
- custom 成功事务不得读写 `credit_lots`、`credit_accounts` 或 debit ledger。
- Background 触发必须 `await triggerBackground()` 的触发请求，但绝不在前台请求内等待 relay/job 完成；漏触发由 cron 补派。
- 浏览器可达模块不得 value-import DB schema。system/基础设施 secrets 永不进客户端；custom 用户 Key 只有 PRD 明确允许的 localStorage 与 HTTPS request-body 例外。
- 所有 admin 页面和 API 双守卫；敏感写二次确认并在同事务写审计。
- 生成不可取消。

## 文档地图

- [docs/PROGRESS.md](docs/PROGRESS.md)：当前状态、阻塞、下一步和历史归档。
- [tasks/prd-user-api-key-modes.md](tasks/prd-user-api-key-modes.md)：当前增量产品契约。
- [docs/superpowers/plans/2026-07-11-user-api-key-modes.md](docs/superpowers/plans/2026-07-11-user-api-key-modes.md)：TDD 实施计划。
- [docs/dev/README.md](docs/dev/README.md)：技术章节索引、部署与验收入口。
- [docs/dev/INSPIRATION-UGC-PLAN.md](docs/dev/INSPIRATION-UGC-PLAN.md)：已上线 UGC 的历史实施记录。
- [docs/dev/deploy.md](docs/dev/deploy.md)：生产部署 runbook。
- [docs/dev/local-acceptance.md](docs/dev/local-acceptance.md)：浏览器验收与 smoke 清单。
- [docs/prototypes/README.md](docs/prototypes/README.md)：结构原型索引。

## 新会话接手顺序

1. 本文件的“已核验快照”和“开工硬门禁”。
2. [docs/PROGRESS.md](docs/PROGRESS.md) 顶部仓库/生产快照与阻塞项。
3. 当前 PRD。
4. 当前实施计划。
5. 计划涉及的 `docs/dev/00-11` 章节和路径规则。
6. 用 Git/数据库/Netlify 证据再次确认状态后才动代码。

## 工作约定

- 每完成一个可验证里程碑，当场更新 PROGRESS；目标契约不承载完成状态。
- 保留用户已有改动，不覆盖无关文件。
- 每个实施任务必须有失败测试、最小实现、新鲜验证和独立提交；中间提交不得暴露会误扣费或误导用户的半成品入口。
- 当前本地实施已完成；未完成生产迁移、暗部署、受控 smoke、启用开关或发布，因此不得把本地验证写成“已上线”。
