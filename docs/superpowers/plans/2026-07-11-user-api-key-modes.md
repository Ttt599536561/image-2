# User API Key Modes and Multi-Task Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project execution override (historical):** 用户后来明确要求跳过逐个微任务，直接完成可用的生图网站。本地实现已按该要求完成；以下微任务账本保留为历史审计、代码定位和生产发布检查清单，不再作为本地实现的逐项领取顺序。
>
> **Review status:** 2026-07-11 全面复审修订并完成本地实现。已补齐分支基线、危险中间提交、旧客户端兼容、system 回归、批量分片、deadline 竞态、凭据清理 SLA、运行时脱敏与测试环境隔离；生产发布闸仍未执行。

**Goal:** 在不改变 system 现有钱链路的前提下，通过统一 `/api/generate` 增加 user-scoped custom Key、任务级加密临时凭据、多任务批量状态追踪，以及 system/custom 共用的五分钟权威 deadline。

**Architecture:** 请求经严格鉴权后按 `credentialMode` 在同一 enqueue 内分流：system 保留余额/并发/预算与成功扣费，custom 跳过这些闸并原子写入 generation + AES-GCM 密文凭据。Background 只接收 `generationId`，按 mode 解析凭据后调用同一个 `callRelay`；成功分别进入计费或零扣费事务，状态读取和 cron 共用 deadline 收口 helper。

**Tech Stack:** React Router 8 framework mode、React 19、TanStack Query v5、Zod 4、Neon Postgres、Drizzle ORM、Netlify Functions/Background/Scheduled Functions、Node `crypto` AES-256-GCM、Vitest、Playwright。

---

## 微任务执行规则（权威施工入口）

> 后文 `技术蓝图 0-11` 保存精确代码、SQL、测试样例和命令；**真正允许执行的任务只有本节微任务账本中的一行**。一个会话窗口只领取一行，完成后立即停止，不顺手做下一行。

### 单任务协议

1. 开始时只读：本节状态块、当前微任务行、该行引用的技术蓝图片段和直接涉及的源码；不得预先实现下一行。
2. 代码任务先补本行最小失败断言并确认按预期失败，再写最小实现；运维/文档任务先保存只读基线证据。
3. 每行目标用时 5-10 分钟。若 10 分钟内仍无法形成独立可验证结果，停止实现，把该行继续拆小并更新本账本；不得跨行凑完成度。
4. 完成前必须运行该行“聚焦验证”，再运行 `git diff --check`，逐行审查本任务 diff，确认没有 Key、URL 凭据、数据库连接串或生产数据进入输出/文档。
5. 只有验证通过才把该行从 `[ ]` 改为 `[x]`，同步“当前状态”和“下一任务”，记录实际命令与结果摘要。验证失败则保持 `[ ]` 并记录阻塞，不得把部分实现写成完成。
6. 每个窗口只报告：本行做了什么、审查/测试证据、改了哪些文件、下一行是什么。即使还有时间，也不开始下一行。
7. P9 的公开入口在 `P9-23` 前必须保持不可达；P11 的生产状态只按真实部署阶段更新。任何中间提交都必须维持 system 行为可编译、可测试且不误导用户。

### 当前状态

| 项目 | 状态 |
|---|---|
| 计划文档微任务化 | [x] 2026-07-11 完成 |
| 功能实施 | [x] 本地完成，生产待部署 |
| 当前微任务 | 本地功能实现与验证已完成；账本仅作历史审计，不再机械逐项勾选 |
| 下一微任务 | 生产发布闸：迁移、暗部署、受控 smoke、启用 custom 与回滚演练（未执行） |
| 最近验证 | 2026-07-11：分支 `codex/user-api-key-modes`，本地功能提交 `0d48d90`，起始实现基线 `34969f59e2ef07909009bd163dc4dbe64d5fb5b0`。历史 P0-04 已由 merge commit `d77b987` 完成。`npm run test:run` 177/177，`npm run test:money` 73/73，`npm run typecheck`、`npm run build`、`npm run assert-no-secrets`、`git diff --check` 均通过；`npm run test:e2e` 为 6 passed / 1 skipped。未部署生产、未执行生产 smoke、未启用生产 custom 开关。 |

### P0：基线与验证地基（技术蓝图 0）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [x] | P0-01 | 只读记录当前分支、HEAD、merge-base、工作树、`main`/生产/UGC/Key 文档提交，发现事实冲突即停。 | `git status --short --branch`; `git log --graph --decorate --oneline -12`; `git merge-base HEAD main` |
| [x] | P0-02 | 从当前文档分支 HEAD 创建/切到 `codex/user-api-key-modes`；只保存分支，不合并、不解决冲突。 | `git status --short --branch`; `git branch --show-current` 精确为目标分支 |
| [x] | P0-03 | 逐文件审查并提交当前已批准的文档修改，确认 staging 中没有业务代码、env 或凭据；有不明文件即停。 | `git diff --cached --name-only`; `git diff --cached --check`; staged 路径仅为 `CLAUDE.md`、`docs/**`、`tasks/**` |
| [x] | P0-04 | 执行 `git merge --no-ff main`，只记录冲突文件清单，不在本任务解决任何冲突。历史 merge commit：`d77b987`。 | `git diff --name-only --diff-filter=U`; `git status --short --branch` |
| [ ] | P0-05 | 只解决 `CLAUDE.md` 冲突，保留 UGC 已上线与 Key 待实施两组事实。 | `git diff --check`; `rg -n -e "^<<<<<<<" -e "^=======" -e "^>>>>>>>" CLAUDE.md` 无命中 |
| [ ] | P0-06 | 只解决 `docs/PROGRESS.md` 冲突；里程碑 13 保持已上线、14 保持待实施。 | `git diff --check`; `rg -n -e "^<<<<<<<" -e "^=======" -e "^>>>>>>>" docs/PROGRESS.md` 无命中 |
| [ ] | P0-07 | 只解决 `docs/dev/09-admin.md` 冲突，兼容 UGC 当前态与 Key 目标态。 | `git diff --check`; 该文件无冲突标记且不含真实凭据 |
| [ ] | P0-08 | 只解决 `docs/dev/local-acceptance.md` 冲突，保留生产 UGC 验收与未来 Key 验收。 | `git diff --check`; 该文件无冲突标记且不把 Key 功能写成已上线 |
| [ ] | P0-09 | 若还有冲突，每次新增一行只解一个文件；全部清零后完成 merge commit 并记录图谱。 | `git diff --name-only --diff-filter=U` 无输出；`git log --graph --decorate --oneline -10` |
| [ ] | P0-10 | 完成管理员密码轮换与会话吊销的人工作业，只记录“已完成 + 时间”，不记录旧值、新值、长度、hash 或前后缀。 | 管理员旧会话失效、新凭据可登录；`rg -n -e "SEED_ADMIN_PASSWORD" -e "管理员密码" CLAUDE.md docs tasks` 人工复核无明文 |
| [ ] | P0-11 | 建立独立 Neon 测试分支与 gitignored `.env.test`，写入两条测试 URL、mutation ack、测试 Auth/主密钥/开关；不修改仓库文件中的真实值。 | `git check-ignore .env.test`; 人工确认测试 endpoint 与本地生产候选不同 |
| [ ] | P0-12 | 精确安装 `@playwright/test` 并只更新 `package.json`/lockfile。参见技术蓝图 0 Step 2。 | `npm ls @playwright/test --depth=0`; `git diff -- package.json package-lock.json` |
| [ ] | P0-13 | 安装与已钉版本匹配的 Chromium，不改业务代码。 | `npx playwright install chromium`; `npx playwright --version` |
| [ ] | P0-14 | 让静态 secrets 门禁加载真实 env，并扫描 `CUSTOM_KEY_JOB_ENCRYPTION_KEY`。参见技术蓝图 0 Step 3。 | `npm run build`; `npm run assert-no-secrets` |
| [ ] | P0-15 | 给 secrets 门禁加入固定公开 URL 精确 allowlist 与 `generation_credentials` 结构标记，不放宽其他值。 | 临时公开 URL 不误报；临时主密钥/结构标记 fixture 必须被门禁命中 |
| [ ] | P0-16 | 实现 `loadDisposableTestEnv()` 的 `.env.test` 解析、mutation ack 和双 URL 缺失拒绝。参见技术蓝图 0 Step 4。 | 暂时移走 `.env.test` 后 guard 在 DB import 前失败；恢复后 `node --import tsx scripts/test-env-guard.ts` 通过 |
| [ ] | P0-17 | 在同一 guard 中实现测试库与本地生产候选的无泄密指纹比较。 | 临时复制生产候选时只报固定拒绝文案且不打印 URL；恢复后通过 |
| [ ] | P0-18 | 为 guard 增加 `import.meta.url` CLI target 模式，import 使用时不误执行 target。 | 无 target 仅校验退出；用无害 target 验证 argv/exit code；单测 import 不启动子程序 |
| [ ] | P0-19 | 让 `tests/money/_setup.ts` 第一条运行时代码复用 guard，并删除 `.env` 回退。 | 缺 `.env.test` 时 `npm run test:money -- tests/money/enqueue.test.ts` 在连接前失败；恢复后聚焦测试通过 |
| [ ] | P0-20 | 新建 `scripts/run-netlify-test.ts`、`dev:netlify:test` 并更新 `.env.example` 的无值说明。 | `npm run dev:netlify:test` 先经过 guard；`git diff -- .env.example package.json scripts/run-netlify-test.ts` 无真实值 |
| [ ] | P0-21 | 运行验证地基的正反路径并提交本阶段，不开始契约代码。 | 技术蓝图 0 Step 5 全部通过；`npm run build`; `npm run assert-no-secrets`; `git diff --check` |

### P1：请求契约与浏览器本地配置（技术蓝图 1）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P1-01 | 为 system 显式 mode 与旧无 Key 请求默认 system 写断言，并实现 `CredentialModeSchema`/默认值。 | `npm run test:run -- src/contracts/generate.test.ts` |
| [ ] | P1-02 | 为 custom 非空/500 字符与 system 禁止携 Key 写断言，并实现 `superRefine` 与三个 API 错误码。 | `npm run test:run -- src/contracts/generate.test.ts` |
| [ ] | P1-03 | 把迁移期 `EMPTY_REQUEST`、regenerate 与现有 Composer fixture 显式设为 system，保持 accepted/status 旧形态不动。 | `npm run test:run -- src/phase1.test.tsx`; `npm run typecheck` |
| [ ] | P1-04 | 为未知用户默认 system、固定 URL 与 storage key 命名写断言，实现最小 load helper。 | `npm run test:run -- src/lib/userApiConfig.test.ts` |
| [ ] | P1-05 | 实现按 user ID 隔离的明文保存，以及切 system 时保留 Key 的纯 helper 行为。 | `npm run test:run -- src/lib/userApiConfig.test.ts` |
| [ ] | P1-06 | 实现损坏 JSON 回退、显式 clear 和同标签页事件；不引入 React。 | `npm run test:run -- src/lib/userApiConfig.test.ts` |
| [ ] | P1-07 | 复跑契约/配置/旧 Composer 回归，审查客户端文件不含 system secret 后提交本阶段。 | `npm run test:run -- src/contracts/generate.test.ts src/lib/userApiConfig.test.ts src/phase1.test.tsx`; `npm run typecheck` |

### P2：mode、deadline 与临时凭据 schema（技术蓝图 2）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P2-01 | 写真库默认值断言，并在 0005 migration 只增加 `credential_mode`、约束、回填与五分钟 `deadline_at`。 | 应用前聚焦测试因缺列失败；仅在 disposable DB 执行 migration |
| [ ] | P2-02 | 在同一 migration 新增 `generation_credentials`、级联 FK 与两个索引，不添加明文字段。 | `npm run test:money -- tests/money/key-mode-schema.test.ts` 的表/级联用例 |
| [ ] | P2-03 | 在 Drizzle `generations` 映射 mode/deadline 与约束/partial index。 | `npm run typecheck` |
| [ ] | P2-04 | 在 Drizzle 增加 `generationCredentials` 映射，只含密文、IV、tag、版本和时间。 | `npm run typecheck`; `rg -n -e "api.?key" -e "authorization" src/db/schema.ts` 不应命中新表字段 |
| [ ] | P2-05 | 新建受 test-env guard 保护的幂等 migration runner，不允许静态 DB import。 | 连续执行 runner 两次均输出 2/2、1/1；测试库外 guard 先拒绝 |
| [ ] | P2-06 | 扩展 money helper 的 mode/deadline options；默认路径仍省略两列以真测数据库默认值。 | `npm run test:money -- tests/money/key-mode-schema.test.ts` |
| [ ] | P2-07 | 给 money helper 增加 `credentials()`，确认用户级 cleanup 通过级联删除。 | `npm run test:money -- tests/money/key-mode-schema.test.ts` |
| [ ] | P2-08 | 复跑 schema、旧 money enqueue 与类型检查，审查 migration additive 后提交本阶段。 | `npm run test:money -- tests/money/key-mode-schema.test.ts tests/money/enqueue.test.ts`; `npm run typecheck` |

### P3：AES-GCM generation-scoped 凭据（技术蓝图 3）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P3-01 | 为缺失/错误长度主密钥写失败断言，实现固定错误类与 32-byte base64 校验。 | `npm run test:run -- src/server/generation/credential.server.test.ts` |
| [ ] | P3-02 | 为 plaintext round-trip 与密文字段不含明文写断言，实现 AES-256-GCM encrypt/decrypt。 | `npm run test:run -- src/server/generation/credential.server.test.ts` |
| [ ] | P3-03 | 覆盖 96-bit 随机 IV、版本拒绝与认证失败；所有失败只抛固定安全文案。 | `npm run test:run -- src/server/generation/credential.server.test.ts` |
| [ ] | P3-04 | 实现只读取 `expires_at > now()` 的 generation-scoped `loadCustomApiKey`，并补有效/过期 DB 断言。 | `npm run test:money -- tests/money/key-mode-schema.test.ts` |
| [ ] | P3-05 | 实现按 generation 删除和按 DB 时钟清理过期凭据；显式 now 仅供测试。 | `npm run test:money -- tests/money/key-mode-schema.test.ts` |
| [ ] | P3-06 | 复跑 crypto/DB、build 与 secrets 门禁，确认 plaintext/主密钥不进客户端后提交。 | `npm run test:run -- src/server/generation/credential.server.test.ts`; `npm run build`; `npm run assert-no-secrets` |

### P4：统一端点的 mode-aware 原子入队（技术蓝图 4）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P4-01 | 扩展 enqueue input/result 类型并在事务外加密；明文不得进入 persistable input。 | `npm run typecheck`; 聚焦 custom 缺 Key/system 携 Key 断言 |
| [ ] | P4-02 | 为零余额、预算满、system 并发满下的三个 custom 入队写断言，并只让 custom 跳过三闸。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-03 | 给 system in-flight 查询加 `credential_mode='system'`，证明 custom 不占 system 槽且旧 system 三闸不变。 | `npm run test:money -- tests/money/enqueue-custom.test.ts tests/money/enqueue.test.ts` |
| [ ] | P4-04 | 两条 generation INSERT 显式写 mode/数据库 deadline 并返回 ISO deadline。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-05 | 在 generation 同一事务写 10 分钟凭据，补 NOT NULL 故障使 conversation/generation/credential 全回滚的断言。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-06 | 补 foreign conversation owner-safe 404 与零写入，保持现有归属检查。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-07 | 补本人/他人占用 generation ID 都返回固定 400，绝不覆盖或泄露 owner。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-08 | 补 foreign inputImageKey 固定 400 与零写入。 | `npm run test:money -- tests/money/enqueue-custom.test.ts` |
| [ ] | P4-09 | handler 分离非法 JSON 与 Zod 解析，固定映射两个 mode 错误并保持鉴权 Response 透传。 | `npm run test:run -- tests/unit/generate-handler.test.ts` |
| [ ] | P4-10 | 在 worker 未完成前给 public custom 加临时 503/零 enqueue/零 trigger gate。 | `npm run test:run -- tests/unit/generate-handler.test.ts` |
| [ ] | P4-11 | 覆盖 system/旧请求三字段 202 与 trigger body 严格只有 generationId，确认只 await 短触发。 | `npm run test:run -- tests/unit/generate-handler.test.ts src/server/generation/trigger.test.ts` |
| [ ] | P4-12 | 复跑 custom/system money、handler、trigger 与类型检查后提交本阶段；public custom 仍不可用。 | 技术蓝图 4 Step 5 全部命令 PASS；`git diff --check` |

### P5：共享 relay、deadline 与 mode-aware 错误（技术蓝图 5）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P5-01 | 为 `deadline - now - 30s` 写边界断言，实现 `relayTimeoutMs`。 | `npm run test:run -- src/server/relay.test.ts` |
| [ ] | P5-02 | 实现 `RelayCredential`/`relayTarget`，证明 custom t2i 只用固定 Base 与本次 bearer。 | `npm run test:run -- src/server/relay.test.ts` |
| [ ] | P5-03 | 证明 custom i2i 复用同一 target 与既有 FormData 构造，不复制 relay。 | `npm run test:run -- src/server/relay.test.ts` |
| [ ] | P5-04 | 删除成功返回的 raw，只允许 `{ images }`，覆盖 provider 2xx 回显哨兵。 | `npm run test:run -- src/server/relay.test.ts` |
| [ ] | P5-05 | 在 relay 边界按实际 Key 脱敏 non-2xx/fetch/JSON/图片解析错误，并使 `invalid_response` 可达。 | `npm run test:run -- src/server/relay.test.ts` |
| [ ] | P5-06 | 实现 system failure 映射回归，429/5xx/配额/内容语义保持原样。 | `npm run test:run -- src/server/generation/failure.test.ts` |
| [ ] | P5-07 | 实现 custom 401/403、配额、429、网络、参数、内容与精确 failureCode 映射。 | `npm run test:run -- src/server/generation/failure.test.ts` |
| [ ] | P5-08 | 扩大通用 Bearer/非 `sk-`/api_key/token 脱敏，证明输入对象不变。 | `npm run test:run -- src/lib/redaction.test.ts` |
| [ ] | P5-09 | 复跑 relay/failure/redaction 与类型检查，确认 optional 参数只为旧 system worker 兼容。 | 技术蓝图 5 Step 6 全部命令 PASS |
| [ ] | P5-10 | 审查无第二 relay、无 raw 泄露、无 Key 日志后提交本阶段。 | `rg -n -e "raw" -e "console.*key" -e "api/generate/custom" src/server/relay.ts src/server/generation src netlify`; `git diff --check` |


### P6：custom 零扣费 worker 与受控 API 启用（技术蓝图 6）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P6-01 | 给 claim 补 mode/deadline 返回断言，并加 `deadline_at > now()` 抢占谓词。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` 的 claim 用例 |
| [ ] | P6-02 | 映射 `ClaimedGeneration.credentialMode/deadlineAt`，旧 system claim fixture 保持通过。 | `npm run test:money -- tests/money/preempt.test.ts tests/money/pipeline.test.ts` |
| [ ] | P6-03 | 新建 custom finalize 的行锁/status/mode 守卫，非 running/custom 返回 lost。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` |
| [ ] | P6-04 | 在 custom finalize 中按现有免费/付费保留期幂等写 image，不读写积分表。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` |
| [ ] | P6-05 | 原子写 succeeded/0 charge/event 并删除凭据，覆盖重入只成功一次。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` |
| [ ] | P6-06 | 增加余额/lot/ledger 前后快照断言，证明 custom finalize 完全不碰钱链路。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/debit.test.ts` |
| [ ] | P6-07 | process 在 claim 后仅为 custom load 当前 generation Key，system 使用显式 `{mode:'system'}`。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts` |
| [ ] | P6-08 | 只让 system 执行日预算 call/ms/告警；custom 不读写这些计数。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/budget.test.ts` |
| [ ] | P6-09 | 两种 mode 调同一 `callRelay` 并传权威 deadline；对象存储异常标 `storage_failed`。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts` |
| [ ] | P6-10 | process 按 mode 分流到 custom finalize 或既有 `chargeOnSuccess`，保持 system 幂等。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts tests/money/debit.test.ts` |
| [ ] | P6-11 | failure path 按实际 mode/Key 脱敏并只在状态谓词命中时写 event；finally 立即删 custom 凭据。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` |
| [ ] | P6-12 | 完成 custom t2i 成功、失败、不回退与重入用例。 | `npm run test:money -- tests/money/pipeline-custom.test.ts` |
| [ ] | P6-13 | 完成 custom i2i、invalid_response、storage_failed 与对应 system 旧码回归。 | `npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts` |
| [ ] | P6-14 | 新建缺省关闭的 `isCustomKeyModesEnabled()` 并覆盖 missing/false/true。 | `npm run test:run -- tests/unit/generate-handler.test.ts` |
| [ ] | P6-15 | 扩展 accepted 五字段契约；handler 只有开关 true 才允许 custom，false 时 503/零副作用。 | `npm run test:run -- tests/unit/generate-handler.test.ts src/contracts/generate.test.ts` |
| [ ] | P6-16 | 把 relay credential/deadline 改为必填，并逐个更新 system smoke/caller；不得一次机械改动未验证的脚本。 | `rg -n "callRelay\(" src scripts tests`; `npm run typecheck` |
| [ ] | P6-17 | 清理 relay probes 的 Key 前后缀/长度/hash 和 raw body 输出，再跑 system/custom 全回归并提交。 | 技术蓝图 6 Step 7；`rg -n -e "key=.*slice" -e "RELAY_API_KEY.*slice" scripts/relay*.ts` 无命中 |

### P7：权威 deadline、批量状态与凭据清理（技术蓝图 7）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P7-01 | 为 queued/claimed/running 到期写断言，实现单条 set-based UPDATE 与 duration 语义。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-02 | 在同一 SQL CTE 原子删除到期 custom 凭据并写一次失败 event。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-03 | 覆盖重复 expire 返回空且不重复 event/debit。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-04 | 用真实并发覆盖 system success 与 timeout 只能一个终态、一个 event。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-05 | 用真实并发覆盖 custom success 与 timeout，只成功时有 image、永远无 debit。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-06 | 实现单 id/批量 query parser、去重、UUID、双参数与 50 上限。 | `npm run test:run -- src/server/generation/status.server.test.ts` |
| [ ] | P7-07 | 扩展 status identity/联合与 batch `missingIds` 契约，不放宽必填 mode/deadline。 | `npm run test:run -- src/server/generation/status.server.test.ts src/contracts/generate.test.ts` |
| [ ] | P7-08 | 实现 owner-scoped `loadGenerationStatuses`：先收口本 owner 到期项，再单查询映射状态。 | `npm run test:money -- tests/money/deadline.test.ts` |
| [ ] | P7-09 | 改造单 ID handler，保持 absent/foreign 统一 404，并新增专用 handler 测试。 | `npm run test:run -- tests/unit/generate-status-handler.test.ts` |
| [ ] | P7-10 | 增加批量 handler 响应与不区分 absent/foreign 的 `missingIds`，覆盖 2 owner + 1 foreign + 1 absent。 | `npm run test:run -- tests/unit/generate-status-handler.test.ts` |
| [ ] | P7-11 | 让 `rescanTimeouts` 共用 deadline helper，补派 stale queued 只选 deadline 未到项。 | `npm run test:money -- tests/money/timeout.test.ts tests/money/deadline.test.ts` |
| [ ] | P7-12 | 新建凭据清理 cron：expire jobs、删 10 分钟孤儿、失败 capture + alert。 | `npm run test:run -- tests/unit/cron-clean-generation-credentials.test.ts` |
| [ ] | P7-13 | 在 `netlify.toml` 加每 5 分钟调度并把旧 timeout 测试改用 deadline，不复制旧 5 分钟 SQL。 | `npm run test:money -- tests/money/timeout.test.ts`; `rg -n "cron-clean-generation-credentials" netlify.toml` |
| [ ] | P7-14 | 扩展受 guard 保护的 cron smoke，验证 15 分钟物理删除边界，跑 deadline/status/cron 回归并提交。 | 技术蓝图 7 Step 7 全部命令 PASS |

### P8：不可达的 Key 配置组件（技术蓝图 8）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P8-01 | 实现 hook 的 ready gate 与 user ID 切换先清旧快照，覆盖 A→B 不短暂暴露 A。 | hook/Modal 聚焦测试；`npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-02 | 实现同标签自定义事件、跨标签 storage、persist/clear 订阅与 cleanup。 | `npm run test:run -- src/lib/userApiConfig.test.ts src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-03 | 建立 dialog skeleton、固定只读 URL、系统/custom radiogroup，ready 前不渲染。 | `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-04 | 实现保存 custom、切 system 保留 Key、显式 clear 回 system。 | `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-05 | 实现空白/500 字符校验和 Eye/EyeOff 显隐；保存时不请求上游。 | `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-06 | 实现初始焦点、Tab 圈定、Escape、scrim close 与卸载后焦点恢复。 | `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P8-07 | 用现有 tokens 完成 360px 稳定尺寸、无嵌套卡片和长文案换行 CSS。 | `npm run build`; 组件测试容器宽 360px 无横向溢出 |
| [ ] | P8-08 | 确认应用中仍无挂载点，跑组件/type/build 后提交；不能让用户进入 custom UI。 | 技术蓝图 8 Step 6；`rg -n "<ApiKeyModal" app src --glob '!**/*.test.tsx'` 只允许组件自身 |

### P9：前端原子启用与多任务轮询（技术蓝图 9）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P9-01 | 实现所有 queued/claimed/running ID 提取，不只取第一项。 | `npm run test:run -- src/lib/generationBatch.test.ts` |
| [ ] | P9-02 | 实现去重排序与 ≤50 分块，补 101 项和 `limit<1` 断言。 | `npm run test:run -- src/lib/generationBatch.test.ts` |
| [ ] | P9-03 | 实现稳定 terminal signature，任一项终态都会变化。 | `npm run test:run -- src/lib/generationBatch.test.ts` |
| [ ] | P9-04 | 给 conversation 契约与 `loadConversation` 查询/映射增加必填 mode/deadline，补全部 fixture。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx`; `npm run typecheck` |
| [ ] | P9-05 | 给 `/api/me` 契约/loader 增加布尔 `customKeyModesEnabled`，只下发布尔值。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx`; `rg -n -e "CUSTOM_KEY_JOB_ENCRYPTION_KEY" -e "RELAY_API_KEY" src/contracts/me.ts src/server/reads.server.ts` 无命中 |
| [ ] | P9-06 | `useGeneration` 改收 `GenerateParams + UserApiConfig`，冻结点击时快照；system body 无 Key，custom body 有 Key 无 baseUrl。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-07 | 乐观 turn 带 mode/临时 deadline，202 后用 server mode/deadline 校正。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-08 | custom 503 时撤销乐观项、缓存 flag=false、invalidate me、保留本地 Key 且不发 system 重试。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-09 | 实现 `loadStatusChunks`，任意 IDs 分块请求并合并 items/missingIds。 | `npm run test:run -- src/lib/generationBatch.test.ts src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-10 | `useGenerationStatuses` 只建一个 Query，2 秒刷新；网络错/本地 deadline/单块终态都不自行停。 | hook fake-timer 测试 |
| [ ] | P9-11 | ConversationView 计算 pending/pending-system 与 mode-aware submissionBlocked；system 旧锁、custom 仅锁当前 enqueue。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-12 | terminal signature 变化刷新会话；仅 system success 刷余额，任一 success 刷资产。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-13 | missing ID 连续两次后触发一次权威会话 refetch；找回则继续采用服务端行。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-14 | refetch 仍缺失时创建 UI-only tombstone、停止该 ID 轮询、保留 prompt，其他 IDs 继续。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-15 | 删除旧单项 timeout 控制；deadline+10s 只切“状态确认中”展示，仍继续 status/refetch。 | fake-timer 组件测试 |
| [ ] | P9-16 | TopBar 实现固定 36px KeyRound 按钮与 ready/current/paused title/aria，但用默认 false 的内部渲染门禁保持生产入口不可达。 | `npm run test:run -- src/components/shell/TopBar.keyModes.test.tsx`；应用默认渲染中按钮数量仍为 0 |
| [ ] | P9-17 | Modal 增加 `customEnabled`：暂停时禁 custom/save、保留 Key、system 始终可选。 | `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx` |
| [ ] | P9-18 | ConversationView 统一空 Key/暂停/system pending/余额 guard，空 Key 打开同一个 Modal。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-19 | Composer 改用 `GenerateParams` + `credentialMode`，ready 前全控件禁用，custom 零本站积分文案且不跳充值。 | `npm run test:run -- src/phase1.test.tsx src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-20 | 补 system/custom 错误文案与手动重试，第三方计费提示准确，不自动改 mode/清 Key。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-21 | 覆盖 3 个 custom 202 后连续提交、system 单任务锁、同动作防重复与乱序终态。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-22 | 覆盖 51 IDs 两请求、missing tombstone、客户端 deadline、server deadline 和首次 503 暂停。 | `npm run test:run -- src/components/conversation/ConversationView.keyModes.test.tsx` |
| [ ] | P9-23 | 同一最终变更挂载 TopBar/Modal/Composer，跑全部前端门禁和四宽度检查后形成原子启用提交。 | 技术蓝图 9 Step 9；`npm run typecheck`; `npm run build`; 360/768/1024/1440 无溢出 |

### P10：admin 可见性与运行时秘密哨兵（技术蓝图 10）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟） | 聚焦验证 |
|---|---|---|---|
| [ ] | P10-01 | admin generation 类型/SELECT/映射只增加 mode 与 charged mp，禁止 join credential 表。 | `npm run test:money -- tests/money/custom-key-security.test.ts`; `rg -n "generation_credentials" src/server/admin app/routes/_admin.generations.tsx` 无命中 |
| [ ] | P10-02 | 后台表增加“模式/扣费”列，custom 0、system 格式化实际值。 | `npm run typecheck`; admin route/component test |
| [ ] | P10-03 | 增加仅 `NODE_ENV=test` 可用的 Sentry test client 注入/restore，真实调用位置不旁路。 | `npm run test:run -- src/server/sentry.server.test.ts` |
| [ ] | P10-04 | `captureException` 对 Error/context/真实 sink/console 统一脱敏，sink 自身失败也安全。 | `npm run test:run -- src/server/sentry.server.test.ts` |
| [ ] | P10-05 | `captureMessage` 对 message/context/真实 sink/console 统一脱敏。 | `npm run test:run -- src/server/sentry.server.test.ts` |
| [ ] | P10-06 | Background handler catch 只输出固定 internal signal，不打印原始异常。 | `npm run test:run -- tests/unit/generate-background-handler.test.ts`; `rg -n "generate-background.*error" netlify/functions/generate-background.ts` 人工审查 |
| [ ] | P10-07 | custom runtime sentinel 覆盖普通表、events、status、admin、console 与 Sentry sink。 | `npm run test:money -- tests/money/custom-key-security.test.ts` |
| [ ] | P10-08 | app_config system sentinel 走真实 system target，覆盖 relay error/console/Sentry/DB/admin/status 并 finally 恢复配置。 | `npm run test:money -- tests/money/custom-key-security.test.ts` |
| [ ] | P10-09 | 复核静态 secrets 门禁仍扫描主密钥/credential 表且只 allowlist 固定 URL。 | `npm run build`; `npm run assert-no-secrets` |
| [ ] | P10-10 | 跑安全/admin/type/build 回归、审查所有观察出口后提交本阶段。 | 技术蓝图 10 Step 6；`git diff --check` |

### P11：隔离 E2E、回滚、全量验证与发布（技术蓝图 11）

| 状态 | ID | 单一可交付结果（每项 5-10 分钟；外部等待不并入下一项） | 聚焦验证 |
|---|---|---|---|
| [ ] | P11-01 | E2E fixture 第一条运行时代码调用 test-env guard，并额外拒绝缺 Auth/主密钥/true 开关。 | 缺任一项时在浏览器启动/DB import 前固定失败 |
| [ ] | P11-02 | fixture 只实现注册测试用户→按 email 找 ID→finally 级联清理。 | 单 fixture 生命周期测试；清理后查询为 0 |
| [ ] | P11-03 | fixture 用同一事务把 lot/account 余额归零并保持对账，不碰全局 app_config。 | 测试前后 balance/lots SUM 一致且为 0 |
| [ ] | P11-04 | fixture 的 generate stub 写 disposable conversation/generation 并返回五字段 202，不存 custom Key、不打真实 relay。 | 聚焦 fixture test；普通表/输出无 sentinel |
| [ ] | P11-05 | fixture 的 status stub 支持乱序 success/failure/timeout、最小 image 与 reload 恢复；finally 清 event/image/generation。 | 聚焦 fixture test；cleanup 后相关行全 0 |
| [ ] | P11-06 | 独立 Playwright system 用例：默认 mode、body 无 Key/baseUrl、pending 锁与终态恢复。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "system 零回归"` |
| [ ] | P11-07 | 独立 custom 零余额三任务用例：三个 202、body 精确、乱序卡片、本站余额 0。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "custom 零余额多任务"` |
| [ ] | P11-08 | 独立 deadline/reload 用例：短 server deadline、确认中仍轮询、provider_timeout、刷新恢复。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "deadline/恢复"` |
| [ ] | P11-09 | 独立 A/B 配置隔离用例：A 持久、B 默认、回 A 恢复、clear 回 system。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "配置持久化与账号隔离"` |
| [ ] | P11-10 | 独立 a11y 用例：mode aria/title、焦点、Tab、Esc、焦点恢复。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "可访问性/响应式"` |
| [ ] | P11-11 | 独立 kill switch 用例：custom 控件禁用、Key 保留、system 可用、绝不静默 custom→system。 | `node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts -g "开关关闭"` |
| [ ] | P11-12 | 用 guard 启动 Netlify 与桌面 E2E，逐条确认六用例全绿且终端无 URL/Key/sentinel。 | 技术蓝图 11 Step 3 的两终端命令 |
| [ ] | P11-13 | 分别跑 360/768/1024/1440，检查截图非空、无横向滚动/遮挡/截字；只完成检查，不顺手修下一项。 | Playwright screenshots + `scrollWidth <= clientWidth` 断言 |
| [ ] | P11-14 | 回滚脚本只实现参数解析、flag=true 拒绝、无泄密统计与默认 dry-run 零写入。 | `npm run test:money -- tests/money/fail-custom-generations.test.ts` dry-run 用例 |
| [ ] | P11-15 | 回滚 apply 加双确认与单事务锁/状态谓词，只收口 custom 非终态。 | rollback money test 的 apply/成功竞态用例 |
| [ ] | P11-16 | 同事务删凭据、逐项 event、单条 audit，并在提交后验证两类计数归零。 | rollback money test 的凭据/event/audit/后置断言 |
| [ ] | P11-17 | 跑回滚脚本完整 money tests，人工审查不 SELECT ciphertext、不输出用户/Key/provider body。 | `npm run test:money -- tests/money/fail-custom-generations.test.ts`; `git diff --check` |
| [ ] | P11-18 | 运行全量 typecheck 与 unit tests，只记录新鲜数字；失败只修本命令暴露的问题并停。 | `npm run typecheck`; `npm run test:run` |
| [ ] | P11-19 | 运行全量 disposable money tests，只记录新鲜数字。 | `npm run test:money` |
| [ ] | P11-20 | 分别通过 guard 跑 cron 与 db smoke，确认会改配置的脚本保存/恢复原值。 | `node --import tsx scripts/test-env-guard.ts scripts/cron-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/db-smoke.ts` |
| [ ] | P11-21 | 分别通过 guard 跑 auth 与 reads smoke。 | `node --import tsx scripts/test-env-guard.ts scripts/auth-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/reads-smoke.ts` |
| [ ] | P11-22 | 分别通过 guard 跑 admin 与 search smoke。 | `node --import tsx scripts/test-env-guard.ts scripts/admin-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/search-smoke.ts` |
| [ ] | P11-23 | 分别通过 guard 跑 inspirations 与 inspiration-submissions smoke。 | `node --import tsx scripts/test-env-guard.ts scripts/inspirations-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/inspiration-submissions-smoke.ts` |
| [ ] | P11-24 | 分别通过 guard 跑 deletes 与 account-reads smoke。 | `node --import tsx scripts/test-env-guard.ts scripts/deletes-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/account-reads-smoke.ts` |
| [ ] | P11-25 | 分别通过 guard 跑 notifications 与 rename smoke。 | `node --import tsx scripts/test-env-guard.ts scripts/notifications-smoke.ts`; `node --import tsx scripts/test-env-guard.ts scripts/rename-smoke.ts` |
| [ ] | P11-26 | 运行 build、静态 secrets 与四组安全 `rg`；确认无第二端点/本地 system Key/日志 Key/admin credential 查询。 | 技术蓝图 11 Step 5 的 build、assert 与四条 `rg` |
| [ ] | P11-27 | 仅把本地事实写入里程碑 14、deploy/local acceptance/ops；生产仍写 system-only。 | `git diff -- docs/PROGRESS.md CLAUDE.md docs/dev`; 文档不得出现“已上线” |
| [ ] | P11-28 | 备份后应用 additive migration，设置新主密钥与 `CUSTOM_KEY_MODES_ENABLED=false` 暗部署；本任务只做到部署可访问。 | migration 2/2、1/1；部署 env 名存在；custom flag=false |
| [ ] | P11-29 | 暗部署只验 system 全链路、旧缺 mode、custom 503 零写入，失败即停。 | 受控生产/staging smoke；generation/credential/ledger 对账 |
| [ ] | P11-30 | 把开关改 true 后只验证受控 custom t2i：落图、本站 0 charge、终态凭据 0。 | 受控账号/API/DB 对账；日志无 sentinel |
| [ ] | P11-31 | 只验证受控 custom i2i 与 admin/status/Sentry/普通表 sentinel 0 命中。 | i2i smoke + 安全查询，不复用 P11-30 结论 |
| [ ] | P11-32 | 演练固定回滚顺序：false 部署→等待/收口 dry-run→必要时 apply→两类计数 0；不 DROP schema/轮换主密钥。 | dry-run/apply 输出、custom 非终态=0、credential=0 |
| [ ] | P11-33 | 仅在 P11-28..32 全部通过后更新生产事实、测试数字、commit/deploy ID，提交验证与交接记录。 | `git diff --check`; 文档交叉引用一致；技术蓝图 11 Step 8 文件清单完整 |

### 微任务覆盖映射

| PRD 范围 | 微任务 |
|---|---|
| FR-1..FR-10：TopBar、Modal、user-scoped 本地配置、ready gate、custom 零余额交互 | P1-04..P1-07、P8-01..P8-08、P9-11、P9-16..P9-23、P11-07、P11-09..P11-13 |
| FR-11..FR-16：单一 `/api/generate`、兼容请求、mode/accepted 契约与 schema 列 | P1-01..P1-03、P2-01..P2-04、P4-01、P4-04、P4-09..P4-12、P6-15 |
| FR-17..FR-24：两类入队闸、原子临时凭据、generation-only trigger 与 10+5 清理 | P2-01..P3-06、P4-01..P4-08、P4-11、P6-11、P7-01..P7-03、P7-12..P7-14 |
| FR-25..FR-31：共享 relay、固定 custom target、不回退、system 扣费与 custom 零扣费 finalize | P5-01..P5-10、P6-03..P6-13、P11-06..P11-07、P11-30..P11-31 |
| FR-32..FR-37：custom 连续提交、system 旧锁、≤50 批量状态、missingIds 与刷新恢复 | P7-06..P7-10、P9-01..P9-15、P9-18..P9-23、P11-07..P11-08 |
| FR-38..FR-43：数据库权威五分钟 deadline、30 秒预留、原子终态竞争与前端确认态 | P2-01、P4-04、P5-01、P6-01..P6-02、P6-09、P7-01..P7-05、P7-11、P9-07、P9-15、P11-08 |
| FR-44..FR-51：错误码、实际 Key 脱敏、手动重试、缺省关闭开关与受审计回滚 | P1-02、P4-01、P4-09..P4-10、P5-04..P5-10、P6-11、P6-13..P6-17、P9-08、P9-17..P9-20、P10-01..P10-10、P11-11、P11-14..P11-17、P11-26、P11-28..P11-32 |
| 横切验证与发布交接 | P0-01..P0-21、P11-01..P11-33 |

## 实施前检查

- 先读 [CLAUDE 当前快照](../../../CLAUDE.md) → [PROGRESS 顶部](../../PROGRESS.md) → [批准版 PRD](../../../tasks/prd-user-api-key-modes.md) → [产品规格 §25](../../redesign-requirements.md) → [技术文档索引](../../dev/README.md)。冲突时先停工对账，不重新提议第二个生图端点。
- **分支硬门禁**：先把 `main@0b4d442` 的 UGC 上线/10 章文档与本轮修订合入同一 `codex/*` 功能分支。记录 merge-base、功能分支 HEAD 与生产 `42d8a0b / 6a3aa2bd`。
- **数据库硬门禁**：money/migration/smoke 只能连接独立 Neon 测试分支和 `.env.test`。禁止连接与生产共用的 `.env` 数据库；没有显式 mutation opt-in 时测试必须 fail closed。
- 跟踪文档曾误含管理员凭据；实施前轮换密码并吊销会话。不要在 issue、日志、命令或提交中复述旧值。
- 从 `P0-01` 顺序执行微任务账本。后文技术蓝图中的 Step checkbox 只用于定位精确代码与测试，不再作为可领取任务或完成状态。
- 每个提交必须能 typecheck/build，且运行时不能出现“UI 宣称 custom、请求仍是 system”或“API 接受 custom、worker 仍按 system 处理”的半成品。
- 公共启用顺序固定：内部 schema/加密/relay/worker/终态安全 → 公共 API 接受 custom → 不可达 Modal → TopBar 与 Composer 同批启用。
- `CUSTOM_KEY_JOB_ENCRYPTION_KEY` 的测试值使用 `Buffer.alloc(32, 7).toString("base64")`；真实值只在部署 Task 11 生成，不写入仓库。

## 文件职责图

| 文件 | 单一职责 |
|---|---|
| `src/contracts/generate.ts` | mode-aware 提交、accepted、单项/批量状态和错误枚举 |
| `src/lib/userApiConfig.ts` | user-scoped 明文 localStorage 读写与变更事件 |
| `src/hooks/useUserApiConfig.ts` | 把当前 user 的本地配置接入 React |
| `src/server/generation/credential.server.ts` | AES-GCM 加解密、取凭据、终态/孤儿删除 |
| `src/server/generation/enqueue.ts` | 严格校验后的 system/custom 原子入队分流 |
| `src/server/relay.ts` | 同一 relay 构造/请求/解析；凭据来源和 deadline 显式注入 |
| `src/server/generation/finalizeCustom.server.ts` | custom 图片成功的幂等零扣费事务 |
| `src/server/generation/deadline.server.ts` | status/cron 共用的五分钟原子收口 |
| `src/server/generation/status.server.ts` | owner-scoped 单项/批量状态读取与映射 |
| `src/components/shell/ApiKeyModal.tsx` | system/custom 单选、Key 显隐/保存/清除、固定 URL |
| `src/hooks/useGenerationStatus.ts` | 当前会话全部非终态 generation 的单请求批量轮询 |
| `drizzle/0005_user_generation_credentials.sql` | mode/deadline/临时凭据表的向后兼容迁移 |
| `tests/money/_setup.ts` | 强制独立 `.env.test` 与显式可破坏测试 opt-in，拒绝默认生产共享库 |
| `scripts/assert-no-secrets-in-bundle.ts` | 加载真实 env 值扫描客户端，同时 allowlist 明确公开的 custom URL |

### 技术蓝图 0：整合基线并修复验证工具

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/assert-no-secrets-in-bundle.ts`
- Modify: `tests/money/_setup.ts`
- Create: `scripts/test-env-guard.ts`
- Create: `scripts/run-netlify-test.ts`
- Modify: `.env.example`

- [ ] **Step 1: 建立单一功能分支并记录证据**

Run:

```powershell
git fetch origin
if (git branch --list codex/user-api-key-modes) {
  git switch codex/user-api-key-modes
} else {
  git switch -c codex/user-api-key-modes
}
git status --short --branch
# P0-03 逐文件审查并 stage 当前文档后：
git commit -m "docs: refine user key modes implementation plan"
git merge --no-ff main
git log --graph --decorate --oneline -8
git status --short --branch
```

Expected: 功能分支从当前 Key 文档 HEAD 建立，先用独立文档提交保存已审修订，再合入 `main@0b4d442`；最终同时包含 `d8e71df/0b4d442` 与本轮 PRD/计划修订。按 P0-05..P0-09 每次只解决一个冲突，工作树中不得混入业务代码、env 或凭据。

- [ ] **Step 2: 钉定 Playwright 运行器**

Run:

```powershell
npm install --save-dev --save-exact @playwright/test
npx playwright install chromium
npm ls @playwright/test --depth=0
```

Expected: `package.json` / lockfile 出现精确版本，`npm ls` exit 0，Chromium 安装成功。

- [ ] **Step 3: 让 secrets 门禁读取真实 env 且不误报公开 URL**

`package.json`：

```json
"assert-no-secrets": "node --env-file-if-exists=.env --import tsx scripts/assert-no-secrets-in-bundle.ts"
```

`scripts/assert-no-secrets-in-bundle.ts` 在 `SECRET_ENV_NAMES` 立即加入：

```ts
"CUSTOM_KEY_JOB_ENCRYPTION_KEY",
```

并在构造 `secretValues` 前加入：

```ts
const PUBLIC_VALUE_ALLOWLIST = new Set([
  "https://api.tangguo.xin/v1",
  "https://api.tangguo.xin/v1/",
]);
```

过滤改为：

```ts
const secretValues = SECRET_ENV_NAMES
  .map((name) => ({ name, value: process.env[name] }))
  .filter((item): item is { name: string; value: string } => {
    return typeof item.value === "string" &&
      item.value.length >= 8 &&
      !PUBLIC_VALUE_ALLOWLIST.has(item.value);
  });
```

固定 custom URL 是已批准的公开产品常量；只 allowlist 这两个精确值，不按域名或前缀放宽。system/custom Key、数据库、存储、Auth、告警值仍必须扫描。

同时把内部表名加入 `STRUCT_MARKERS`：

```ts
"generation_credentials",
```

这只阻止服务端内部结构进入静态客户端 bundle，不会扫描或阻止浏览器运行时由用户本人输入的 Key。

- [ ] **Step 4: 强制所有破坏性验证使用独立 `.env.test`**

在 `.env.example` 只增加说明，不放任何连接值：

```dotenv
# Destructive money/migration tests MUST use a separate gitignored .env.test.
# .env.test must contain DATABASE_URL, DATABASE_URL_UNPOOLED and:
# MONEY_TEST_ALLOW_MUTATION=I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE
# Local E2E also needs BETTER_AUTH_URL/BETTER_AUTH_SECRET, a test-only
# CUSTOM_KEY_JOB_ENCRYPTION_KEY, and CUSTOM_KEY_MODES_ENABLED=true.
```

创建 `scripts/test-env-guard.ts`，导出 `loadDisposableTestEnv()`。它只解析 `.env.test`，并在任何 DB import/测试前硬拒绝：

```ts
const MUTATION_ACK = "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE";
const testEnvPath = resolve(process.cwd(), ".env.test");
const raw = readFileSync(testEnvPath, "utf8");
for (const line of raw.split(/\r?\n/)) {
  const text = line.trim();
  if (!text || text.startsWith("#")) continue;
  const eq = text.indexOf("=");
  if (eq <= 0) continue;
  const key = text.slice(0, eq).trim();
  let value = text.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}
if (process.env.MONEY_TEST_ALLOW_MUTATION !== MUTATION_ACK) {
  throw new Error("[money-test] refusing destructive tests without disposable database acknowledgement");
}
if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_UNPOOLED) {
  throw new Error("[money-test] .env.test must provide both Neon test-branch URLs");
}
```

若本地 `.env` 存在，再解析其中两条生产候选 URL，只计算不输出 `URL.hostname` 去掉 `-pooler` 后的 endpoint 标识 + pathname 指纹；`.env.test` 任一 DB 指纹与 `.env` 相同就立即拒绝。错误只写“test database matches local production candidate”，不得打印 URL、用户名或密码。

`tests/money/_setup.ts` 第一条运行时代码调用该 helper，删除回退加载 `.env` 的逻辑。创建 `scripts/run-netlify-test.ts` 调用同一 helper 后，以继承 stdio 启动 `node_modules/netlify-cli/bin/run.js dev`；`package.json` 增加：

```json
"dev:netlify:test": "node --import tsx scripts/run-netlify-test.ts"
```

money、migration、Playwright 的 Netlify server 全部复用同一 guard，不能各自实现一套弱校验。

`scripts/test-env-guard.ts` 同时提供 CLI 模式：`node --import tsx scripts/test-env-guard.ts <target> [...targetArgs]` 先完成上述拒绝检查，再把 `process.argv` 重写为目标程序期望的形式并动态 import 目标；无 target 时只验证配置后退出。CLI 分支必须用 `import.meta.url` 与入口参数判断“当前文件是直接执行入口”，被 migration、money setup 或 Netlify runner import 时只能导出 helper，不能自行再次 import target。后续所有会改库的 smoke 与 Playwright CLI 都通过这个入口运行，无需逐个复制 guard。

- [ ] **Step 5: 验证两个门禁都能失败和通过**

Run:

```powershell
Rename-Item .env.test .env.test.hold
npm run test:money -- tests/money/enqueue.test.ts
Rename-Item .env.test.hold .env.test
npm run test:money -- tests/money/enqueue.test.ts
npm run build
npm run assert-no-secrets
```

Expected: 第一条 money test 在连接数据库前固定失败；恢复独立测试 env 后通过。另用 `.env` 的 DB URL 临时替换 `.env.test` 值时必须在连接前因指纹相同失败，测试后恢复 `.env.test`。secrets 门禁显示真实注入项，公开固定 URL 不误报，新增主密钥值和其余 secrets 不在 `build/client`。

- [ ] **Step 6: 提交验证地基**

```bash
git add package.json package-lock.json scripts/assert-no-secrets-in-bundle.ts scripts/test-env-guard.ts scripts/run-netlify-test.ts tests/money/_setup.ts .env.example
git commit -m "test: isolate destructive verification tooling"
```

### 技术蓝图 1：锁定契约与 user-scoped 本地配置

**Files:**
- Create: `src/contracts/generate.test.ts`
- Create: `src/lib/userApiConfig.ts`
- Create: `src/lib/userApiConfig.test.ts`
- Modify: `src/contracts/generate.ts:5-94`
- Modify: `src/contracts/error.ts:13-31`
- Modify: `src/components/conversation/ConversationView.tsx:30-42,272-283`
- Modify: `src/phase1.test.tsx:7-21`

- [ ] **Step 1: 写失败的契约测试**

在 `src/contracts/generate.test.ts` 写入：

```ts
import { describe, expect, it } from "vitest";
import { GenerateRequest } from "./generate";

const base = { prompt: "test", size: "1024x1024" };

describe("GenerateRequest credential mode", () => {
  it("accepts system without customApiKey", () => {
    expect(GenerateRequest.parse({ ...base, credentialMode: "system" }).credentialMode).toBe("system");
  });

  it("keeps old keyless requests compatible as system", () => {
    expect(GenerateRequest.parse(base).credentialMode).toBe("system");
  });

  it("requires a nonblank custom key", () => {
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom" }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom", customApiKey: "   " }).success).toBe(false);
    expect(GenerateRequest.safeParse({ ...base, credentialMode: "custom", customApiKey: "x".repeat(501) }).success).toBe(false);
  });

  it("trims a custom key before it reaches enqueue", () => {
    expect(GenerateRequest.parse({ ...base, credentialMode: "custom", customApiKey: "  sk-value  " }).customApiKey)
      .toBe("sk-value");
  });

  it("forbids customApiKey in system mode", () => {
    const explicit = GenerateRequest.safeParse({
      ...base,
      credentialMode: "system",
      customApiKey: "x".repeat(501),
    });
    expect(explicit.success).toBe(false);
    if (!explicit.success) {
      expect(explicit.error.issues.map((issue) => issue.message)).toContain("SYSTEM_MODE_FORBIDS_CUSTOM_KEY");
    }
    expect(GenerateRequest.safeParse({ ...base, customApiKey: "sk-must-not-travel" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:run -- src/contracts/generate.test.ts`

Expected: FAIL；旧 `GenerateRequest` 不识别 mode/default/forbidden-key 规则。

- [ ] **Step 3: 拆分参数契约并加入 mode-aware schema**

在 `src/contracts/generate.ts` 保留现有尺寸/质量/背景定义，替换请求、错误码和状态响应区为：

```ts
export const CredentialModeSchema = z.enum(["system", "custom"]);
export type CredentialMode = z.infer<typeof CredentialModeSchema>;

export const SYSTEM_ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "provider_timeout",
  "content_rejected",
  "invalid_request",
  "relay_unreachable",
  "unknown",
] as const;

export const CUSTOM_ERROR_CODES = [
  "custom_key_invalid",
  "custom_key_quota",
  "relay_rate_limited",
  "provider_timeout",
  "relay_unreachable",
  "invalid_request",
  "content_rejected",
  "invalid_response",
  "storage_failed",
  "unknown",
] as const;
export const ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "custom_key_invalid",
  "custom_key_quota",
  "relay_rate_limited",
  "provider_timeout",
  "relay_unreachable",
  "invalid_request",
  "content_rejected",
  "invalid_response",
  "storage_failed",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const GenerateParams = z.object({
  prompt: z.string().min(1, "prompt 不能为空").max(4000),
  size: z.enum(SIZES),
  quality: z.enum(QUALITIES).optional(),
  background: z.enum(BACKGROUNDS).optional(),
});
export type GenerateParams = z.infer<typeof GenerateParams>;

export const GenerateRequest = GenerateParams.extend({
  conversationId: z.uuid().optional(),
  generationId: z.uuid().optional(),
  inputImageKey: z.string().min(1).max(300).optional(),
  credentialMode: CredentialModeSchema.default("system"),
  customApiKey: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.credentialMode === "system" && value.customApiKey !== undefined) {
    ctx.addIssue({ code: "custom", path: ["customApiKey"], message: "SYSTEM_MODE_FORBIDS_CUSTOM_KEY" });
  }
  if (value.credentialMode === "custom") {
    const trimmed = value.customApiKey?.trim() ?? "";
    if (!trimmed) {
      ctx.addIssue({ code: "custom", path: ["customApiKey"], message: "CUSTOM_KEY_REQUIRED" });
    } else if (trimmed.length > 500) {
      ctx.addIssue({ code: "custom", path: ["customApiKey"], message: "CUSTOM_KEY_TOO_LONG" });
    }
  }
}).transform((value) => ({
  ...value,
  customApiKey: value.customApiKey?.trim(),
}));
export type GenerateRequest = z.infer<typeof GenerateRequest>;

```

本 Task 不修改现有 `GenerateAcceptedResponse` / `GenerateStatusResponse` 的运行时形态，避免旧 handler 仍返回三字段/无 identity 时解析失败。accepted 扩展与 handler 在 Task 6 同批落地；status/batch 联合与 handler 在 Task 7 同批落地。system 新任务继续写 `SYSTEM_ERROR_CODES`，custom 写 `CUSTOM_ERROR_CODES`，读取接受 `ERROR_CODES` 并集。

在 `src/contracts/error.ts` 的 `API_ERROR_CODES` 加入：

```ts
"CUSTOM_KEY_REQUIRED",
"SYSTEM_MODE_FORBIDS_CUSTOM_KEY",
"CUSTOM_KEY_MODES_DISABLED",
```

为保证本 task 的提交仍可编译，把 `ConversationView.tsx` 的 `EMPTY_REQUEST` 和旧 regenerate 请求先显式设为 system：

```ts
const EMPTY_REQUEST: GenerateRequest = {
  prompt: "",
  size: "auto",
  quality: "auto",
  background: "auto",
  credentialMode: "system",
};

runGeneration({
  prompt: turn.prompt,
  size: turn.size as Size,
  quality: (turn.quality as Quality | null) ?? "auto",
  background: (turn.background as Background | null) ?? "auto",
  credentialMode: "system",
});
```

Task 9 会把 Composer 参数与凭据配置拆开，并从当前用户选择动态提供 mode；此处只维持迁移期间的 system 行为。

在 `src/phase1.test.tsx` 的 `baseReq` 增加 `credentialMode: "system"`，让现有 Composer 测试继续使用合法的迁移期请求。

- [ ] **Step 4: 写失败的 localStorage 测试**

在 `src/lib/userApiConfig.test.ts` 写入：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_RELAY_BASE_URL,
  clearUserApiConfig,
  loadUserApiConfig,
  saveUserApiConfig,
} from "./userApiConfig";

describe("userApiConfig", () => {
  beforeEach(() => localStorage.clear());

  it("defaults each unknown user to system", () => {
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
    expect(CUSTOM_RELAY_BASE_URL).toBe("https://api.tangguo.xin/v1");
  });

  it("stores plaintext per user and keeps accounts isolated", () => {
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a-plain" });
    saveUserApiConfig("user-b", { mode: "system", customApiKey: "sk-b-retained" });
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", customApiKey: "sk-a-plain" });
    expect(loadUserApiConfig("user-b")).toEqual({ mode: "system", customApiKey: "sk-b-retained" });
  });

  it("recovers from invalid JSON and clear returns to system", () => {
    localStorage.setItem("image-workshop:api-config:v1:user-a", "not-json");
    expect(loadUserApiConfig("user-a").mode).toBe("system");
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a" });
    clearUserApiConfig("user-a");
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
  });

  it("notifies same-tab subscribers", () => {
    const listener = vi.fn();
    window.addEventListener("user-api-config-changed", listener);
    saveUserApiConfig("user-a", { mode: "custom", customApiKey: "sk-a" });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("user-api-config-changed", listener);
  });
});
```

- [ ] **Step 5: 运行 localStorage 测试并确认失败**

Run: `npm run test:run -- src/lib/userApiConfig.test.ts`

Expected: FAIL，提示 `userApiConfig` 模块不存在。

- [ ] **Step 6: 实现纯客户端本地配置 helper**

创建 `src/lib/userApiConfig.ts`：

```ts
import type { CredentialMode } from "../contracts/generate";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";
export const USER_API_CONFIG_EVENT = "user-api-config-changed";
export const MAX_CUSTOM_API_KEY_LENGTH = 500;

export interface UserApiConfig {
  mode: CredentialMode;
  customApiKey: string;
}

const fallback = (): UserApiConfig => ({ mode: "system", customApiKey: "" });
export const userApiConfigStorageKey = (userId: string) => `image-workshop:api-config:v1:${userId}`;

export function loadUserApiConfig(userId: string): UserApiConfig {
  if (typeof window === "undefined") return fallback();
  try {
    const parsed = JSON.parse(localStorage.getItem(userApiConfigStorageKey(userId)) ?? "null") as Partial<UserApiConfig> | null;
    if (!parsed || (parsed.mode !== "system" && parsed.mode !== "custom")) return fallback();
    return {
      mode: parsed.mode,
      customApiKey: typeof parsed.customApiKey === "string" ? parsed.customApiKey : "",
    };
  } catch {
    return fallback();
  }
}

export function saveUserApiConfig(userId: string, value: UserApiConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(userApiConfigStorageKey(userId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(USER_API_CONFIG_EVENT, { detail: { userId } }));
}

export function clearUserApiConfig(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(userApiConfigStorageKey(userId));
  window.dispatchEvent(new CustomEvent(USER_API_CONFIG_EVENT, { detail: { userId } }));
}
```

- [ ] **Step 7: 运行契约与本地配置测试**

Run: `npm run test:run -- src/contracts/generate.test.ts src/lib/userApiConfig.test.ts`

Expected: 2 test files PASS，所有 mode/default/key/user-isolation 断言通过；旧 accepted/status fixture 仍按当前形态解析。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add src/contracts/generate.ts src/contracts/generate.test.ts src/contracts/error.ts src/lib/userApiConfig.ts src/lib/userApiConfig.test.ts src/components/conversation/ConversationView.tsx src/phase1.test.tsx
git commit -m "feat: define user credential mode contracts"
```

### 技术蓝图 2：增加 mode、deadline 和临时凭据 schema

**Files:**
- Create: `drizzle/0005_user_generation_credentials.sql`
- Create: `scripts/migrate-user-generation-credentials.ts`
- Create: `tests/money/key-mode-schema.test.ts`
- Modify: `src/db/schema.ts:193-234`
- Modify: `tests/money/_helpers.ts:31-168`

- [ ] **Step 1: 写失败的真库 schema 测试**

创建 `tests/money/key-mode-schema.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestCtx, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("key mode schema", () => {
  it("defaults generations to system and creates a five minute deadline", async () => {
    const uid = await ctx.createUser();
    const conversationId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    await ctx.sql`INSERT INTO conversations(id,user_id,title) VALUES(${conversationId},${uid},'schema default')`;
    await ctx.sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size)
                  VALUES(${generationId},${conversationId},${uid},'default probe','auto')`;
    const g = await ctx.gen(generationId);
    expect(g?.credential_mode).toBe("system");
    expect(Date.parse(String(g?.deadline_at)) - Date.parse(String(g?.created_at))).toBe(300_000);
  });

  it("stores only encrypted credential material and cascades on generation delete", async () => {
    const uid = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(uid, { credentialMode: "custom" });
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${generationId},'cipher-b64','iv-b64','tag-b64',1,now()+interval '10 minutes')`;
    expect((await ctx.credentials(generationId)).length).toBe(1);
    await ctx.sql`DELETE FROM generations WHERE id=${generationId}`;
    expect((await ctx.credentials(generationId)).length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试并确认 schema 尚不存在**

Run: `npm run test:money -- tests/money/key-mode-schema.test.ts`

Expected: FAIL，数据库报告 `credential_mode`、`deadline_at` 或 `generation_credentials` 不存在。

- [ ] **Step 3: 编写 additive migration**

创建 `drizzle/0005_user_generation_credentials.sql`：

```sql
ALTER TABLE generations
  ADD COLUMN IF NOT EXISTS credential_mode text NOT NULL DEFAULT 'system';

DO $$ BEGIN
  ALTER TABLE generations ADD CONSTRAINT generations_credential_mode_chk
    CHECK (credential_mode IN ('system','custom'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE generations ADD COLUMN IF NOT EXISTS deadline_at timestamptz;

UPDATE generations
SET deadline_at = created_at + interval '5 minutes'
WHERE deadline_at IS NULL;

ALTER TABLE generations ALTER COLUMN deadline_at SET DEFAULT (now() + interval '5 minutes');
ALTER TABLE generations ALTER COLUMN deadline_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS generation_credentials (
  generation_id uuid PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gen_inflight_deadline
  ON generations(deadline_at)
  WHERE status IN ('queued','claimed','running');

CREATE INDEX IF NOT EXISTS ix_generation_credentials_expires
  ON generation_credentials(expires_at);
```

- [ ] **Step 4: 更新 Drizzle schema**

在 `src/db/schema.ts` 的 `generations` 字段中加入：

```ts
credentialMode: text("credential_mode").notNull().default("system"),
deadlineAt: timestamp("deadline_at", tz).notNull().default(sql`now() + interval '5 minutes'`),
```

在其约束数组加入：

```ts
check("generations_credential_mode_chk", sql`${t.credentialMode} IN ('system','custom')`),
index("ix_gen_inflight_deadline")
  .on(t.deadlineAt)
  .where(sql`${t.status} IN ('queued','claimed','running')`),
```

在 `generations` 后、`images` 前新增：

```ts
export const generationCredentials = pgTable(
  "generation_credentials",
  {
    generationId: uuid("generation_id")
      .primaryKey()
      .references(() => generations.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("ix_generation_credentials_expires").on(t.expiresAt)],
);
```

- [ ] **Step 5: 增加幂等迁移脚本并应用到测试库**

创建 `scripts/migrate-user-generation-credentials.ts`：

```ts
import { readFileSync } from "node:fs";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();
const { getPool } = await import("../src/db/db.server");
const ddl = readFileSync(new URL("../drizzle/0005_user_generation_credentials.sql", import.meta.url), "utf8");
const pool = getPool();
const client = await pool.connect();
try {
  await client.query(ddl);
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM information_schema.columns
        WHERE table_name='generations' AND column_name IN ('credential_mode','deadline_at')) AS generation_columns,
       (SELECT count(*) FROM information_schema.tables
        WHERE table_name='generation_credentials') AS credential_tables`,
  );
  console.log(
    `[migrate] 0005 applied. generation columns=${result.rows[0].generation_columns}/2 credential table=${result.rows[0].credential_tables}/1`,
  );
} finally {
  client.release();
  await pool.end();
}
process.exit(0);
```

Run: `node --import tsx scripts/migrate-user-generation-credentials.ts`

Expected: guard 先确认 disposable 数据库，随后输出 `[migrate] 0005 applied. generation columns=2/2 credential table=1/1`。禁止恢复静态 DB import 或 `--env-file=.env.test` 直连旁路。

- [ ] **Step 6: 扩展 money 测试 helper**

把 `TestCtx.createGeneration` 的 options 改为：

```ts
createGeneration(
  userId: string,
  opts?: {
    status?: string;
    startedAtAgoSec?: number;
    credentialMode?: "system" | "custom";
    deadlineAgoSec?: number;
  },
): Promise<{ conversationId: string; generationId: string }>;
credentials(generationId: string): Promise<Array<Record<string, unknown>>>;
```

测试 helper 只有在 options 明确传入 mode/deadline 时才显式写列；默认路径省略二列，保证 schema default 真正被测试。可用两个分支：

```ts
if (opts.credentialMode === undefined && opts.deadlineAgoSec === undefined) {
  await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,started_at)
            VALUES(${genId},${convId},${userId},'mtest prompt','auto',${status},
                   CASE WHEN ${status} IN ('claimed','running')
                        THEN now()-(${opts.startedAtAgoSec ?? 0}::int*interval '1 second') ELSE NULL END)`;
} else {
  const mode = opts.credentialMode ?? "system";
  const deadlineAgo = opts.deadlineAgoSec ?? -300;
  await sql`INSERT INTO generations(id,conversation_id,user_id,prompt,size,status,credential_mode,deadline_at,started_at)
            VALUES(${genId},${convId},${userId},'mtest prompt','auto',${status},${mode},
                   now()-(${deadlineAgo}::int*interval '1 second'),
                   CASE WHEN ${status} IN ('claimed','running')
                        THEN now()-(${opts.startedAtAgoSec ?? 0}::int*interval '1 second') ELSE NULL END)`;
}
```

实现查询：

```ts
async credentials(generationId) {
  return (await sql`SELECT * FROM generation_credentials WHERE generation_id=${generationId}`) as Array<Record<string, unknown>>;
},
```

`cleanup()` 无需单独删凭据，`users → conversations → generations` 级联会删除。

- [ ] **Step 7: 运行 schema 测试与类型检查**

Run: `npm run test:money -- tests/money/key-mode-schema.test.ts`

Expected: PASS，2 个 schema 用例通过。

Run: `npm run typecheck`

Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add drizzle/0005_user_generation_credentials.sql scripts/migrate-user-generation-credentials.ts src/db/schema.ts tests/money/_helpers.ts tests/money/key-mode-schema.test.ts
git commit -m "feat: add generation credential mode schema"
```

### 技术蓝图 3：实现 AES-GCM 任务级临时凭据

**Files:**
- Create: `src/server/generation/credential.server.ts`
- Create: `src/server/generation/credential.server.test.ts`

- [ ] **Step 1: 写失败的加密生命周期测试**

创建 `src/server/generation/credential.server.test.ts`：

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialConfigurationError,
  decryptCustomApiKey,
  encryptCustomApiKey,
} from "./credential.server";

const original = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  if (original === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = original;
});

describe("custom credential AES-GCM", () => {
  it("round trips without placing plaintext in encrypted fields", () => {
    const plaintext = "sk-sentinel-7bc90a5d";
    const encrypted = encryptCustomApiKey(plaintext);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(encrypted.keyVersion).toBe(1);
    expect(decryptCustomApiKey(encrypted)).toBe(plaintext);
  });

  it("uses a random 96-bit IV", () => {
    const first = encryptCustomApiKey("sk-same");
    const second = encryptCustomApiKey("sk-same");
    expect(first.iv).not.toBe(second.iv);
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
  });

  it("fails closed with a fixed message for an invalid master key", () => {
    process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = "short";
    expect(() => encryptCustomApiKey("sk-value")).toThrow(CredentialConfigurationError);
    expect(() => encryptCustomApiKey("sk-value")).toThrow("custom credential encryption is unavailable");
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `npm run test:run -- src/server/generation/credential.server.test.ts`

Expected: FAIL，提示无法导入 `credential.server`。

- [ ] **Step 3: 实现加解密和 DB 生命周期函数**

创建 `src/server/generation/credential.server.ts`：

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSql } from "../../db/db.server";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";
export const CUSTOM_CREDENTIAL_KEY_VERSION = 1;

export class CredentialConfigurationError extends Error {
  constructor() {
    super("custom credential encryption is unavailable");
    this.name = "CredentialConfigurationError";
  }
}

export interface EncryptedCustomApiKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function masterKey(): Buffer {
  const raw = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== 32) throw new CredentialConfigurationError();
  return key;
}

export function encryptCustomApiKey(apiKey: string): EncryptedCustomApiKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CUSTOM_CREDENTIAL_KEY_VERSION,
  };
}

export function decryptCustomApiKey(value: EncryptedCustomApiKey): string {
  if (value.keyVersion !== CUSTOM_CREDENTIAL_KEY_VERSION) throw new CredentialConfigurationError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CredentialConfigurationError();
  }
}

export async function loadCustomApiKey(generationId: string): Promise<string> {
  const rows = await getSql()`SELECT ciphertext,iv,auth_tag,key_version
                              FROM generation_credentials
                              WHERE generation_id=${generationId} AND expires_at>now()`;
  const row = rows[0];
  if (!row) throw new CredentialConfigurationError();
  return decryptCustomApiKey({
    ciphertext: row.ciphertext as string,
    iv: row.iv as string,
    authTag: row.auth_tag as string,
    keyVersion: Number(row.key_version),
  });
}

export async function deleteGenerationCredential(generationId: string): Promise<void> {
  await getSql()`DELETE FROM generation_credentials WHERE generation_id=${generationId}`;
}

export async function deleteExpiredGenerationCredentials(now?: Date): Promise<number> {
  const rows = now
    ? await getSql()`DELETE FROM generation_credentials WHERE expires_at<=${now.toISOString()} RETURNING generation_id`
    : await getSql()`DELETE FROM generation_credentials WHERE expires_at<=now() RETURNING generation_id`;
  return rows.length;
}
```

加密 helper 不计算 TTL；生产有效期与过期判断全部使用数据库时钟。显式 `now` 参数只为不等待时钟的测试保留在 cleanup helper，生产/cron 调用必须省略。

- [ ] **Step 4: 运行单测和 secrets 静态断言回归**

Run: `npm run test:run -- src/server/generation/credential.server.test.ts`

Expected: PASS，3 个 AES-GCM 用例通过。

Run:

```powershell
npm run build
npm run assert-no-secrets
```

Expected: build exit 0，`assert-no-secrets` PASS；Task 0 已使门禁加载真实 `.env` 并扫描主密钥，测试 plaintext 和 env 主密钥值均不在 `build/client`。

- [ ] **Step 5: 提交**

```bash
git add src/server/generation/credential.server.ts src/server/generation/credential.server.test.ts
git commit -m "feat: encrypt generation scoped custom credentials"
```

### 技术蓝图 4：在统一 `/api/generate` 中实现 mode-aware 原子入队

**Files:**
- Create: `tests/money/enqueue-custom.test.ts`
- Create: `tests/unit/generate-handler.test.ts`
- Create: `src/server/generation/trigger.test.ts`
- Modify: `src/server/generation/enqueue.ts:17-112`
- Modify: `netlify/functions/generate.ts:1-32`

- [ ] **Step 1: 写 custom 绕过闸门但仍隔离资源的失败测试**

创建 `tests/money/enqueue-custom.test.ts`：

```ts
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey } from "../../src/server/budget.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;
let previousBudget: unknown;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
  previousBudget = undefined;
});
afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  if (previousBudget === undefined) {
    await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;
  } else {
    await ctx.sql`INSERT INTO app_config(key,value_json) VALUES(${budgetTodayKey()},${JSON.stringify(previousBudget)}::jsonb)
                  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
  }
  await ctx.cleanup();
});

describe("custom enqueue", () => {
  it("queues three jobs with zero balance while system budget and concurrency are full", async () => {
    const uid = await ctx.createUser({ balanceMp: 0, maxConcurrency: 1 });
    await ctx.createGeneration(uid, { status: "running", credentialMode: "system" });
    const [budgetBefore] = await ctx.sql`SELECT value_json FROM app_config WHERE key=${budgetTodayKey()}`;
    previousBudget = budgetBefore?.value_json;
    await ctx.sql`INSERT INTO app_config(key,value_json)
                  VALUES(${budgetTodayKey()},'{"calls":99999999,"ms":0}'::jsonb)
                  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;

    const results = await Promise.all(
      ["one", "two", "three"].map((prompt) =>
        enqueueGeneration({
          user: { id: uid, maxConcurrency: 1 },
          input: {
            prompt,
            size: "auto",
            credentialMode: "custom",
            customApiKey: "sk-custom-plain-sentinel",
          },
        }),
      ),
    );

    expect(results).toHaveLength(3);
    const rows = await ctx.sql`SELECT credential_mode,credits_charged_mp,deadline_at-created_at AS ttl
                               FROM generations WHERE id=ANY(${results.map((r) => r.generationId)}::uuid[])`;
    expect(rows.every((row) => row.credential_mode === "custom" && Number(row.credits_charged_mp) === 0)).toBe(true);
    const ttlRows = await ctx.sql`SELECT EXTRACT(EPOCH FROM (c.expires_at-g.created_at))::int AS ttl_sec
                                  FROM generation_credentials c JOIN generations g ON g.id=c.generation_id
                                  WHERE g.id=ANY(${results.map((r) => r.generationId)}::uuid[])`;
    expect(ttlRows.every((row) => Number(row.ttl_sec) >= 599 && Number(row.ttl_sec) <= 601)).toBe(true);
    expect((await ctx.sql`SELECT count(*)::int AS n FROM generation_credentials
                          WHERE generation_id=ANY(${results.map((r) => r.generationId)}::uuid[])`)[0].n).toBe(3);
    expect(JSON.stringify(await ctx.sql`SELECT * FROM generation_credentials
                                        WHERE generation_id=ANY(${results.map((r) => r.generationId)}::uuid[])`)).not.toContain(
      "sk-custom-plain-sentinel",
    );
  });

  it("does not let custom jobs consume system concurrency slots", async () => {
    const uid = await ctx.createUser({ balanceMp: 10_000, maxConcurrency: 1 });
    await ctx.createGeneration(uid, { status: "running", credentialMode: "custom" });
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 1 },
        input: { prompt: "system still has its slot", size: "auto", credentialMode: "system" },
      }),
    ).resolves.toMatchObject({ credentialMode: "system" });
  });

  it("keeps owner checks and rejects malformed internal mode usage", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const foreignKey = `uploads/${randomUUID()}/ref.png`;
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: {
          prompt: "edit",
          size: "auto",
          inputImageKey: foreignKey,
          credentialMode: "custom",
          customApiKey: "sk-custom",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: { prompt: "bad", size: "auto", credentialMode: "system", customApiKey: "sk-forbidden" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails closed before creating a generation when encryption is unavailable", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
    await expect(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: { prompt: "p", size: "auto", credentialMode: "custom", customApiKey: "sk-value" },
      }),
    ).rejects.toThrow("custom credential encryption is unavailable");
    expect(await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).toHaveLength(0);
  });
});
```

同一 money 文件继续加入四组 owner/事务负向用例：

- 传入另一用户的 `conversationId` 固定 owner-safe 404，且不创建 generation/credential。
- 传入已存在的 `generationId`（分别由本人或他人占用）都固定 `400 INVALID_PARAM`“任务标识无效”，不覆盖旧行、不泄露 owner。
- 传入另一用户前缀的 `inputImageKey` 固定 400，且不创建 generation/credential。
- mock `encryptCustomApiKey` 返回 `authTag:null as never`，让 credential INSERT 命中 NOT NULL 失败；断言同一事务中的新 conversation、generation 与 credential 全部回滚，HTTP/日志不回显 DB 原文或 Key。

- [ ] **Step 2: 运行测试并确认 custom 仍被旧三闸拒绝**

Run: `npm run test:money -- tests/money/enqueue-custom.test.ts`

Expected: FAIL；旧 `EnqueueRequest` 无 mode 字段，或零余额 custom 返回 402。

- [ ] **Step 3: 扩展 enqueue 类型并在事务外加密**

在 `src/server/generation/enqueue.ts` 增加 imports：

```ts
import type { CredentialMode } from "../../contracts/generate";
import { encryptCustomApiKey, type EncryptedCustomApiKey } from "./credential.server";
```

扩展类型：

```ts
export interface EnqueueRequest {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  conversationId?: string;
  generationId?: string;
  inputImageKey?: string | null;
  credentialMode: CredentialMode;
  customApiKey?: string;
}

export interface EnqueueResult {
  generationId: string;
  conversationId: string;
  credentialMode: CredentialMode;
  deadlineAt: string;
}

type PersistableEnqueueRequest = Omit<EnqueueRequest, "customApiKey">;
```

把现有 account lock、并发、余额和预算代码包在：

```ts
if (input.credentialMode === "system") {
  const acct = await c.query("SELECT balance_mp FROM credit_accounts WHERE user_id=$1 FOR UPDATE", [user.id]);
  if (acct.rowCount === 0) throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  const inflight = await c.query(
    "SELECT COUNT(*)::int AS n FROM generations WHERE user_id=$1 AND credential_mode='system' AND status IN ('queued','claimed','running')",
    [user.id],
  );
  const current = Number(inflight.rows[0].n);
  if (current >= user.maxConcurrency) {
    throw httpError(409, "CONCURRENCY_LIMIT", "超出并发数量", { limit: user.maxConcurrency, current });
  }
  const priceMp = await readConfigInt(c, "price_per_image_mp", 70);
  const balance = await c.query(
    `SELECT COALESCE(SUM(remaining_mp),0)::bigint AS s FROM credit_lots
     WHERE user_id=$1 AND remaining_mp>0 AND (expires_at IS NULL OR expires_at>now())`,
    [user.id],
  );
  if (Number(balance.rows[0].s) < priceMp) {
    throw httpError(402, "INSUFFICIENT_CREDITS", "积分不足，去充值");
  }
  if (await isDailyBudgetExhausted(c)) {
    throw httpError(429, "BUDGET_EXHAUSTED", "今日额度已满，请稍后");
  }
}
```

修改 `run` 签名，让 input 使用 `PersistableEnqueueRequest` 并额外接收 `encrypted: EncryptedCustomApiKey | null`；把两条 generation INSERT 都改为显式写 mode/deadline、返回 deadline：

```sql
INSERT INTO generations(
  id,conversation_id,user_id,prompt,model,size,quality,background,moderation,input_image_key,
  credential_mode,deadline_at,status
)
VALUES($1,$2,$3,$4,'gpt-image-2',$5,$6,$7,'low',$8,$9,now()+interval '5 minutes','queued')
ON CONFLICT (id) DO NOTHING
RETURNING id,deadline_at
```

只有客户端显式提供 `generationId` 的分支使用 `ON CONFLICT (id) DO NOTHING RETURNING`；若 `rowCount===0`，无论旧行归本人还是他人都返回固定 `400 INVALID_PARAM`“任务标识无效”。没有客户端 `generationId` 的分支使用同一字段顺序但移除 `id`、第一个参数与 conflict 子句。generation 插入后，在返回 202 前执行：

```ts
if (input.credentialMode === "custom") {
  if (!encrypted) throw httpError(500, "INTERNAL", "自定义 Key 暂时不可用");
  await c.query(
    `INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
     VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
    [gen.rows[0].id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyVersion],
  );
}
return {
  generationId: gen.rows[0].id as string,
  conversationId,
  credentialMode: input.credentialMode,
  deadlineAt: new Date(gen.rows[0].deadline_at as string).toISOString(),
};
```

导出函数负责固定错误和明文最短生命周期：

```ts
export async function enqueueGeneration(args: { user: EnqueueUser; input: EnqueueRequest }): Promise<EnqueueResult> {
  const { input } = args;
  if (input.credentialMode === "custom" && !input.customApiKey?.trim()) {
    throw httpError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key");
  }
  if (input.credentialMode === "system" && input.customApiKey !== undefined) {
    throw httpError(400, "SYSTEM_MODE_FORBIDS_CUSTOM_KEY", "系统 Key 模式不接受自定义 Key");
  }
  const { customApiKey, ...persistableInput } = input;
  const encrypted = input.credentialMode === "custom" ? encryptCustomApiKey((customApiKey as string).trim()) : null;
  return tx((client) => run(client, args.user, persistableInput, encrypted));
}
```

- [ ] **Step 4: 保持公共 handler 为 system-only，避免旧 worker 误处理 custom**

把 `netlify/functions/generate.ts` 的 JSON 解析与 schema 解析分开。非法 JSON 固定 400；在 Task 6 worker/终态安全完成前，公共入口显式拒绝 custom，不创建 generation，也不触发后台：

```ts
let body: unknown;
try {
  body = await req.json();
} catch {
  return httpError(400, "INVALID_PARAM", "请求体无效");
}
const parsed = GenerateRequest.safeParse(body);
if (!parsed.success) {
  const issueCodes = new Set(parsed.error.issues.map((issue) => issue.message));
  if (issueCodes.has("SYSTEM_MODE_FORBIDS_CUSTOM_KEY")) {
    return httpError(400, "SYSTEM_MODE_FORBIDS_CUSTOM_KEY", "系统 Key 模式不接受自定义 Key");
  }
  if (issueCodes.has("CUSTOM_KEY_REQUIRED")) {
    return httpError(400, "CUSTOM_KEY_REQUIRED", "请先填写并保存自定义 Key");
  }
  return httpError(400, "INVALID_PARAM", "参数无效");
}
if (parsed.data.credentialMode === "custom") {
  return httpError(503, "CUSTOM_KEY_MODES_DISABLED", "自定义 Key 功能尚未启用");
}
const accepted = await enqueueGeneration({
  user: { id: ctx.userId, maxConcurrency: ctx.maxConcurrency },
  input: parsed.data,
});
await triggerBackground(accepted.generationId);
return Response.json(
  { generationId: accepted.generationId, conversationId: accepted.conversationId, status: "queued" },
  { status: 202 },
);
```

创建 `tests/unit/generate-handler.test.ts`（node environment；从测试目录 import Functions handler，避免 Netlify 把测试文件扫描成函数入口），mock guard/enqueue/trigger，并逐项断言：

- 非法 JSON → `400 INVALID_PARAM`，enqueue/trigger 均未调用。
- custom 缺 Key → `400 CUSTOM_KEY_REQUIRED`；system 或缺 mode 携 Key → `400 SYSTEM_MODE_FORBIDS_CUSTOM_KEY`；两者均零副作用。
- Task 4 的 custom gate → `503 CUSTOM_KEY_MODES_DISABLED`，零 enqueue/trigger。
- system/旧请求成功 → 三字段 202；`triggerBackground` 只以 accepted `generationId` 作为唯一实参被 await。
- guard 抛出 401 或 403 `BANNED` Response 时原样透传，enqueue/trigger 均未调用。

创建 `src/server/generation/trigger.test.ts`，stub `fetch` 并断言 POST body 严格等于 `{generationId}`，不含 prompt、mode、Key 或 request 明细；同时证明 handler 的 202 只等待触发请求返回，不等待 background job 完成。handler 的 catch 继续只写固定 `[generate] error`；不得记录 body/Zod input。Task 6 在 worker 安全后原子替换临时 503 gate，并与五字段 accepted 契约同批启用。

同步修正 `netlify/functions/generate.ts` 文件头和行内注释：统一写“await 短触发请求，触发 helper 吞错；不等待 relay/background job”。不得继续使用会被误读为 `void fetch` 的“fire-and-forget”字样。

- [ ] **Step 5: 跑 custom 与 system enqueue 回归**

Run: `npm run test:money -- tests/money/enqueue-custom.test.ts tests/money/enqueue.test.ts`

Run: `npm run test:run -- tests/unit/generate-handler.test.ts src/server/generation/trigger.test.ts`

Expected: PASS；custom 内部入队、custom 不占 system 并发、既有 system 三闸/owner-scope/事务回滚全部通过；HTTP custom 固定 503 且零副作用；非法 JSON、鉴权透传、精确 mode 错误和纯 generationId 触发载荷均有回归。

Run: `npm run typecheck`

Expected: exit 0；Task 1 的迁移期前端请求已显式使用 system mode，server/schema 也无类型错误。

- [ ] **Step 6: 提交**

```bash
git add src/server/generation/enqueue.ts netlify/functions/generate.ts tests/money/enqueue-custom.test.ts tests/unit/generate-handler.test.ts src/server/generation/trigger.test.ts
git commit -m "feat: enqueue custom key generations"
```

### 技术蓝图 5：让同一个 relay 支持显式凭据和 deadline

**Files:**
- Create: `src/server/relay.test.ts`
- Create: `src/server/generation/failure.test.ts`
- Modify: `src/server/relay.ts:1-185`
- Modify: `src/server/generation/failure.ts:1-39`
- Modify: `src/lib/redaction.ts:1-39`
- Modify: `src/lib/redaction.test.ts:1-36`

- [ ] **Step 1: 写 custom 固定 URL、剩余 deadline 和错误映射测试**

在 `src/server/relay.test.ts` 写入：

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { callRelay, relayTimeoutMs } from "./relay";

afterEach(() => vi.unstubAllGlobals());

describe("custom relay target", () => {
  it("uses the fixed base, custom bearer, and remaining deadline", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "p",
      size: "1024x1024",
      credential: { mode: "custom", apiKey: "sk-custom-sentinel" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/generations");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-custom-sentinel",
    );
    expect(relayTimeoutMs(Date.now() + 90_000, Date.now())).toBeGreaterThanOrEqual(59_900);
    expect(relayTimeoutMs(Date.now() + 20_000, Date.now())).toBe(0);
  });

  it("uses the same custom target for image edits", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "edit",
      size: "1024x1024",
      inputImage: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" },
      credential: { mode: "custom", apiKey: "sk-custom-sentinel" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/edits");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("does not return a successful raw body that echoes the active key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ data: [{ b64_json: "aGVsbG8=" }], debug: { authorization: "sk-custom-sentinel" } }),
    ));
    const result = await callRelay({
      prompt: "p",
      size: "1024x1024",
      credential: { mode: "custom", apiKey: "sk-custom-sentinel" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(Object.keys(result)).toEqual(["images"]);
    expect(JSON.stringify(result)).not.toContain("sk-custom-sentinel");
  });
});
```

在 `src/server/generation/failure.test.ts` 写入：

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeFailure } from "./failure";

const error = (message: string, httpStatus?: number) => Object.assign(new Error(message), { httpStatus });

describe("mode-aware failure mapping", () => {
  it.each([
    ["custom", error("bad credentials", 401), "custom_key_invalid"],
    ["custom", error("insufficient_quota", 402), "custom_key_quota"],
    ["custom", error("billing quota exhausted", 403), "custom_key_quota"],
    ["custom", error("too many requests", 429), "relay_rate_limited"],
    ["custom", error("content_policy", 403), "content_rejected"],
    ["custom", error("invalid size", 400), "invalid_request"],
    ["custom", error("gateway unavailable", 503), "relay_unreachable"],
    ["system", error("insufficient_quota", 402), "insufficient_quota"],
    ["system", error("too many requests", 429), "relay_5xx"],
    ["system", error("gateway unavailable", 503), "relay_5xx"],
  ] as const)("maps provider errors without changing system semantics", (mode, err, code) => {
    expect(normalizeFailure(err, { mode, secrets: ["sk-secret"] }).code).toBe(code);
  });

  it("redacts the actual custom key before returning a message", () => {
    const result = normalizeFailure(error("echo sk-secret", 401), {
      mode: "custom",
      secrets: ["sk-secret"],
    });
    expect(result.message).not.toContain("sk-secret");
  });
});
```

- [ ] **Step 2: 运行测试并确认旧 relay 只能读取 system 配置**

Run: `npm run test:run -- src/server/relay.test.ts src/server/generation/failure.test.ts`

Expected: FAIL，旧 `callRelay` 不接受 `credential/deadlineAt`，旧错误枚举也无 custom codes。

- [ ] **Step 3: 重构 relay target，不复制请求构造**

在 `src/server/relay.ts` 定义：

```ts
import type { CredentialMode } from "../contracts/generate";
import { CUSTOM_RELAY_BASE_URL } from "./generation/credential.server";

export type RelayCredential =
  | { mode: "system" }
  | { mode: "custom"; apiKey: string };

export function relayTimeoutMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs - 30_000);
}

async function relayTarget(credential: RelayCredential): Promise<{ mode: CredentialMode; key: string; bases: string[] }> {
  if (credential.mode === "custom") {
    return { mode: "custom", key: credential.apiKey, bases: [CUSTOM_RELAY_BASE_URL] };
  }
  return { mode: "system", key: await relayKey(), bases: await relayBases() };
}
```

把 `callRelay` 参数扩展为：

```ts
export interface CallRelayRequest {
  prompt: string;
  size: string;
  quality?: string | null;
  background?: string | null;
  inputImage?: RelayInputImage | null;
  credential?: RelayCredential;
  deadlineAt?: Date;
}
```

函数开头改为：

```ts
export async function callRelay(req: CallRelayRequest): Promise<{ images: RelayImage[] }> {
  const credential = req.credential ?? { mode: "system" as const };
  const deadlineAt = req.deadlineAt ?? new Date(Date.now() + RELAY_SOFT_TIMEOUT_MS + 30_000);
  const { key, bases } = await relayTarget(credential);
  const timeoutMs = relayTimeoutMs(deadlineAt.getTime());
  if (timeoutMs <= 0) throw new DOMException("provider deadline exceeded", "AbortError");
  const isEdit = Boolean(req.inputImage);
  const endpoint = isEdit ? "/images/edits" : undefined;
```

把每次循环的 timer 从固定 `RELAY_SOFT_TIMEOUT_MS` 改为：

```ts
const remainingMs = relayTimeoutMs(deadlineAt.getTime());
if (remainingMs <= 0) throw new DOMException("provider deadline exceeded", "AbortError");
const timer = setTimeout(() => ctrl.abort(), remainingMs);
```

保留现有 t2i JSON、i2i FormData、response_format 与 system backup 循环；custom 的 `bases` 只有固定 URL，因此永不尝试 system/backup Base。optional fallback 只保证 Task 5 提交与旧 system worker 兼容；Task 6 更新所有调用点后立即改回必填。

在 relay 边界新增实际 Key 脱敏，并让解析异常可达 `invalid_response`：

```ts
function sanitizeRelayError(error: unknown, key: string): Error & {
  httpStatus?: number;
  failureCode?: ErrorCode;
} {
  const source = (error ?? {}) as { name?: string; message?: string; httpStatus?: number; failureCode?: ErrorCode };
  const safe = new Error(redactText(String(source.message ?? "relay failure"), [key]));
  safe.name = source.name ?? "Error";
  return Object.assign(safe, { httpStatus: source.httpStatus, failureCode: source.failureCode });
}
```

- 非 2xx response body、fetch error 和 provider error 在 throw 前都调用 `sanitizeRelayError(error, key)`。
- JSON 解析或 `parseImageGenerationResponse` 失败时，先用实际 Key 脱敏，再附加 `failureCode: "invalid_response"`；不要依赖不可达的 `if (!images.length)`。
- 成功返回只含 `{ images }`，删除 `raw`。若将来要调试 raw，必须在 relay 内先 `redactSecrets(raw,[key])`，本期不返回。

- [ ] **Step 4: 实现 mode-aware failure mapping**

在 `src/server/generation/failure.ts` 把签名与分类替换为：

```ts
import type { CredentialMode, ErrorCode } from "../../contracts/generate";
import { redactText } from "../../lib/redaction";

type RelayErrorLike = { name?: string; httpStatus?: number; message?: string; failureCode?: ErrorCode };

export function normalizeFailure(
  err: unknown,
  context: { mode: CredentialMode; secrets: string[] },
): { code: ErrorCode; message: string; httpStatus?: number } {
  const value = (err ?? {}) as RelayErrorLike;
  const status = value.httpStatus;
  const raw = redactText(String(value.message ?? ""), context.secrets);
  if (value.failureCode) {
    const code = context.mode === "system" &&
      (value.failureCode === "invalid_response" || value.failureCode === "storage_failed")
      ? "unknown"
      : value.failureCode;
    return { code, message: raw.slice(0, 500), httpStatus: status };
  }
  if (value.name === "AbortError" || status === 504 || /timeout|timed out|deadline/i.test(raw)) {
    return { code: "provider_timeout", message: "请求超时，本站未扣积分，请重试", httpStatus: status };
  }
  if (
    /moderation|safety|content_policy|rejected/i.test(raw) ||
    (status === 403 && /content|policy/i.test(raw)) ||
    (context.mode === "system" && status === 403)
  ) {
    return { code: "content_rejected", message: raw.slice(0, 500), httpStatus: status };
  }
  if (/insufficient_quota|quota|billing|欠费/i.test(raw) || status === 402) {
    return {
      code: context.mode === "custom" ? "custom_key_quota" : "insufficient_quota",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  if (context.mode === "custom" && (status === 401 || status === 403)) {
    return { code: "custom_key_invalid", message: raw.slice(0, 500), httpStatus: status };
  }
  if (status === 429) {
    return {
      code: context.mode === "custom" ? "relay_rate_limited" : "relay_5xx",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  if (status === 400 || /invalid|must use|unsupported|dimension|format/i.test(raw)) {
    return { code: "invalid_request", message: raw.slice(0, 500), httpStatus: status };
  }
  if (value.name === "TypeError" || /fetch failed|ECONN|network/i.test(raw)) {
    return { code: "relay_unreachable", message: raw.slice(0, 500), httpStatus: status };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: context.mode === "custom" ? "relay_unreachable" : "relay_5xx",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  return { code: "unknown", message: raw.slice(0, 500), httpStatus: status };
}
```

`storage_failed` 与 `invalid_response` 由调用阶段通过 `failureCode` 标记；只在 custom 保留精确码，system 按上述兼容分支继续写 `unknown`。测试必须覆盖 system malformed response/storage failure 不产生 custom-only 错误码。

- [ ] **Step 5: 扩大通用 bearer 脱敏但不改变返回形态**

在 `src/lib/redaction.ts` 把 patterns 改为：

```ts
const GENERIC_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b(api[_-]?key|token)\s*[:=]\s*[A-Za-z0-9._~+\/-]{8,}/gi,
];
```

在 `src/lib/redaction.test.ts` 增加非 `sk-` 自定义 Key 和 header/body 回显测试，断言原对象不变、输出不含 sentinel。

- [ ] **Step 6: 跑 relay、failure、redaction 测试**

Run:

```powershell
npm run test:run -- src/server/relay.test.ts src/server/generation/failure.test.ts src/lib/redaction.test.ts
npm run typecheck
```

Expected: PASS；固定 URL、剩余 deadline、成功 raw 不外泄、invalid_response 可达、system 旧错误码、custom 错误码和高熵 Key 脱敏全部通过；Task 5 提交可 typecheck。

- [ ] **Step 7: 提交**

```bash
git add src/server/relay.ts src/server/relay.test.ts src/server/generation/failure.ts src/server/generation/failure.test.ts src/lib/redaction.ts src/lib/redaction.test.ts
git commit -m "feat: route generation credentials through one relay"
```

### 技术蓝图 6：实现 custom 零扣费 worker 并原子启用公共 API

**Files:**
- Create: `src/server/generation/finalizeCustom.server.ts`
- Create: `src/server/generation/feature.server.ts`
- Create: `tests/money/pipeline-custom.test.ts`
- Modify: `src/server/money/preempt.server.ts:10-52`
- Modify: `src/server/generation/process.ts:15-117`
- Modify: `src/server/relay.ts`
- Modify: `src/contracts/generate.ts`
- Modify: `netlify/functions/generate.ts`
- Modify: `tests/unit/generate-handler.test.ts`
- Modify: `scripts/relay-smoke.ts`
- Modify: `scripts/relay-edits-call-smoke.ts`
- Modify: `scripts/relay-chat-probe.ts`
- Modify: `scripts/relay-edits-probe.ts`
- Modify: `scripts/relay-format-probe.ts`
- Modify: `tests/money/pipeline.test.ts:1-191`

- [ ] **Step 1: 写 custom 成功、失败、重入和不回退测试**

创建 `tests/money/pipeline-custom.test.ts`，复用 `pipeline.test.ts` 的 1px PNG/put 桩，并加入：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PutResult } from "../../src/server/r2.server";
import { encryptCustomApiKey } from "../../src/server/generation/credential.server";
import { runGenerationJob, type ProcessDeps } from "../../src/server/generation/process";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
const apiKey = "sk-custom-runtime-sentinel";
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

async function createCustom(uid: string): Promise<string> {
  const { generationId } = await ctx.createGeneration(uid, { credentialMode: "custom" });
  const sealed = encryptCustomApiKey(apiKey);
  await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                VALUES(${generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},${sealed.keyVersion},now()+interval '10 minutes')`;
  return generationId;
}

const storage = async (_uid: string, gid: string): Promise<PutResult> => ({
  storageKey: `mtest/${gid}.png`,
  publicUrl: `https://img.test/${gid}.png`,
  contentType: "image/png",
  width: 1,
  height: 1,
  sizeBytes: 70,
});

describe("custom pipeline", () => {
  it("succeeds with zero charge and deletes the credential", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const callRelay = vi.fn(async (request) => {
      expect(request.credential).toEqual({ mode: "custom", apiKey });
      return { images: [{ b64_json: "aGVsbG8=" }] };
    });
    expect(await runGenerationJob(gid, { callRelay, putToR2: storage })).toBe("succeeded");
    expect(Number((await ctx.gen(gid))?.credits_charged_mp)).toBe(0);
    expect(await ctx.balanceMp(uid)).toBe(0);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect(await ctx.images(gid)).toHaveLength(1);
    expect(await ctx.credentials(gid)).toHaveLength(0);
    expect(await runGenerationJob(gid, { callRelay, putToR2: storage })).toBe("lost");
    expect(callRelay).toHaveBeenCalledOnce();
  });

  it("never falls back to system when the custom key fails", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const callRelay: ProcessDeps["callRelay"] = async (request) => {
      expect(request.credential.mode).toBe("custom");
      throw Object.assign(new Error(`401 echoed ${apiKey}`), { httpStatus: 401 });
    };
    expect(await runGenerationJob(gid, { callRelay })).toBe("failed");
    const generation = await ctx.gen(gid);
    expect(generation?.error_code).toBe("custom_key_invalid");
    expect(String(generation?.error)).not.toContain(apiKey);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect(await ctx.credentials(gid)).toHaveLength(0);
  });

  it("runs custom image-to-image through the shared relay and still charges zero", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const gid = await createCustom(uid);
    const inputImageKey = `uploads/${uid}/ref.png`;
    await ctx.sql`UPDATE generations SET input_image_key=${inputImageKey} WHERE id=${gid}`;
    let observedInput = false;
    const outcome = await runGenerationJob(gid, {
      getUploadObject: async (key) => {
        expect(key).toBe(inputImageKey);
        return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" };
      },
      callRelay: async (request) => {
        observedInput = Boolean(request.inputImage);
        expect(request.credential).toEqual({ mode: "custom", apiKey });
        return { images: [{ b64_json: "aGVsbG8=" }] };
      },
      putToR2: storage,
    });
    expect(outcome).toBe("succeeded");
    expect(observedInput).toBe(true);
    expect(await ctx.balanceMp(uid)).toBe(0);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
  });
});
```

同文件补 custom `invalid_response`/`storage_failed` 精确码且零扣费测试；`pipeline.test.ts` 补对应 system 回归，证明同样两类底层失败继续写既有 `unknown`，不会产生 custom-only 错误码。两组都断言成功/失败返回值不含 `raw` provider body。

- [ ] **Step 2: 运行测试并确认 process 仍强制 system budget/debit**

Run: `npm run test:money -- tests/money/pipeline-custom.test.ts`

Expected: FAIL；claim 未返回 mode/deadline，process 未解密凭据且仍调用 `chargeOnSuccess`。

- [ ] **Step 3: 扩展 claim 返回 mode/deadline**

在 `src/server/money/preempt.server.ts` 的 `ClaimedGeneration` 增加：

```ts
credentialMode: "system" | "custom";
deadlineAt: Date;
```

claim SQL 增加 `credential_mode,deadline_at`，并把 WHERE 改成：

```sql
WHERE id=${generationId} AND status='queued' AND deadline_at>now()
RETURNING id,user_id,prompt,size,quality,background,input_image_key,credential_mode,deadline_at
```

映射新增：

```ts
credentialMode: r.credential_mode as "system" | "custom",
deadlineAt: new Date(r.deadline_at as string),
```

- [ ] **Step 4: 实现 custom 幂等成功事务**

创建 `src/server/generation/finalizeCustom.server.ts`：

```ts
import { readConfigInt } from "../config.server";
import { retentionExpiry } from "../r2.server";
import { tx } from "../tx.server";
import type { DebitInput } from "../money/debit.server";

export async function finalizeCustomSuccess(input: DebitInput): Promise<"succeeded" | "lost"> {
  return tx(async (client) => {
    const generation = await client.query(
      "SELECT status,credential_mode FROM generations WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [input.generationId, input.userId],
    );
    if (
      generation.rowCount === 0 ||
      generation.rows[0].status !== "running" ||
      generation.rows[0].credential_mode !== "custom"
    ) {
      return "lost";
    }
    const freeDays = await readConfigInt(client, "retention_free_days", 7);
    const paidDays = await readConfigInt(client, "retention_paid_days", 60);
    const user = await client.query("SELECT has_paid FROM users WHERE id=$1", [input.userId]);
    const expiresAt = retentionExpiry({ has_paid: Boolean(user.rows[0]?.has_paid) }, { freeDays, paidDays });
    await client.query(
      `INSERT INTO images(generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(generation_id) DO NOTHING`,
      [
        input.generationId,
        input.userId,
        input.storageKey,
        input.publicUrl,
        input.contentType ?? null,
        input.width ?? null,
        input.height ?? null,
        input.sizeBytes ?? null,
        expiresAt,
      ],
    );
    const updated = await client.query(
      `UPDATE generations SET status='succeeded',credits_charged_mp=0,completed_at=now(),
         duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
       WHERE id=$1 AND status='running' AND credential_mode='custom' RETURNING duration_ms`,
      [input.generationId],
    );
    if (updated.rowCount !== 1) return "lost";
    await client.query("INSERT INTO events(type,user_id,payload) VALUES('image_succeeded',$1,$2)", [
      input.userId,
      {
        generationId: input.generationId,
        credentialMode: "custom",
        creditsChargedMp: 0,
        durationMs: Number(updated.rows[0].duration_ms),
      },
    ]);
    await client.query("DELETE FROM generation_credentials WHERE generation_id=$1", [input.generationId]);
    return "succeeded";
  });
}
```

- [ ] **Step 5: 分流 Background 编排**

在 `src/server/generation/process.ts`：

1. import `loadCustomApiKey/deleteGenerationCredential`、`finalizeCustomSuccess`、`RelayCredential`。
2. system 才运行 `incCallIfUnderCap`、budget alert 和 `incMs`。
3. custom 在 claim 后只加载当前 generation 的 Key。
4. 调同一个 `callRelay` 时传 `credential` 与 `deadlineAt`。
5. storage/empty response 写显式 failureCode。

核心控制流替换为：

```ts
let credential: RelayCredential = { mode: "system" };
try {
  if (g.credentialMode === "custom") {
    credential = { mode: "custom", apiKey: await loadCustomApiKey(generationId) };
  }

  if (g.credentialMode === "system" && !(await incCallIfUnderCap())) {
    if (await markBudgetAlertedOnce()) {
      await alert("daily_budget_exhausted", { exhausted: true, source: "generation", generationId });
    }
    await sql`UPDATE generations SET status='failed',error_code='insufficient_quota',error='今日额度已满，请稍后',
              completed_at=now(),duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
              WHERE id=${generationId} AND status='running'`;
    return "budget_exhausted";
  }

  const { images } = await callRelay({
    prompt: g.prompt,
    size: g.size,
    quality: g.quality,
    background: g.background,
    inputImage,
    credential,
    deadlineAt: g.deadlineAt,
  });
let obj: Awaited<ReturnType<typeof realPutToR2>>;
try {
  obj = await putToR2(g.userId, generationId, images[0]);
} catch {
  throw Object.assign(new Error("图片保存失败，本站未扣积分，请重试"), {
    failureCode: "storage_failed" as const,
  });
}

if (g.credentialMode === "custom") {
  const outcome = await finalizeCustomSuccess({
    generationId,
    userId: g.userId,
    storageKey: obj.storageKey,
    publicUrl: obj.publicUrl,
    contentType: obj.contentType,
    width: obj.width ?? null,
    height: obj.height ?? null,
    sizeBytes: obj.sizeBytes,
  });
  return outcome === "succeeded" ? "succeeded" : "lost";
}
  const charged = await chargeOnSuccess({
    generationId,
    userId: g.userId,
    storageKey: obj.storageKey,
    publicUrl: obj.publicUrl,
    contentType: obj.contentType,
    width: obj.width ?? null,
    height: obj.height ?? null,
    sizeBytes: obj.sizeBytes,
  });
  return charged.outcome === "not_running" ? "lost" : "succeeded";
} catch (err) {
  const secrets = credential.mode === "custom" ? [credential.apiKey] : [];
  const { code, message, httpStatus } = normalizeFailure(err, { mode: g.credentialMode, secrets });
  const updated = await sql`UPDATE generations SET status='failed',error_code=${code},error=${message},
                             http_status=${httpStatus ?? null},completed_at=now(),
                             duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
                            WHERE id=${generationId} AND status='running' RETURNING id`;
  if (updated.length > 0) {
    await sql`INSERT INTO events(type,user_id,payload)
              VALUES('image_failed',${g.userId},${JSON.stringify({ generationId, reason: code, credentialMode: g.credentialMode })}::jsonb)`;
  }
  return updated.length > 0 ? "failed" : "lost";
} finally {
  if (g.credentialMode === "custom") await deleteGenerationCredential(generationId);
  else await incMs(Date.now() - t0);
}
```

不得在任何日志打印 `credential` 或 request body。

更新 `tests/money/pipeline.test.ts` 的 system relay 桩，让它接受并断言 `credential.mode==='system'` 和 `deadlineAt instanceof Date`。

- [ ] **Step 6: 所有调用点安全后，原子启用公共 custom API**

创建 server-only `isCustomKeyModesEnabled()`，仅当 `CUSTOM_KEY_MODES_ENABLED === "true"` 返回 true，缺省/空值一律 false。所有 custom money/API 测试显式设置并在 finally 恢复该 env；另测默认关闭时返回 `503 CUSTOM_KEY_MODES_DISABLED`、不建 generation、不写 credential、不触发 background。

扩展 Task 4 的 `tests/unit/generate-handler.test.ts`：缺 env/false 两种情况均断言 503 与零 enqueue/trigger；true 时 custom 才调用 enqueue，返回五字段 202，并且 trigger 仍只有 `generationId` 一个实参。每条测试用 `try/finally` 恢复原 env；不得依赖测试执行顺序。

把 `src/server/relay.ts` 的 `credential/deadlineAt` 从 Task 5 的兼容 optional 改回必填。更新两个真中转 smoke 的 system 调用：

```ts
const deadlineAt = new Date(Date.now() + 5 * 60_000);
const { images } = await callRelay({
  prompt,
  size: "1024x1024",
  credential: { mode: "system" },
  deadlineAt,
});
```

同批清理发布探针的秘密日志：`relay-smoke.ts`、`relay-chat-probe.ts`、`relay-edits-probe.ts`、`relay-format-probe.ts` 只能输出 `key=PRESENT` 或 `key=MISSING`，禁止 Key 前缀、后缀、长度或 hash。三个直接 fetch 的 probe 在打印 provider body/Error 前必须用本次实际 Key 调 `redactText(...,[key])`；`relay-edits-call-smoke.ts` 只接收已经在 `callRelay` 边界脱敏的异常。新增静态断言 `rg -n "key=.*slice|RELAY_API_KEY.*slice" scripts/relay*.ts` 无命中。

`src/contracts/generate.ts` 此时才把 accepted 扩成：

```ts
export const GenerateAcceptedResponse = z.object({
  generationId: z.uuid(),
  conversationId: z.uuid(),
  status: z.literal("queued"),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.iso.datetime(),
});
export type GenerateAccepted = z.infer<typeof GenerateAcceptedResponse>;
```

`netlify/functions/generate.ts` 用功能开关替换 Task 4 的临时 503 gate。保留非法 JSON 400 与 `safeParse` 固定错误；custom 且开关关闭时固定返回上述 503；开关开启才入队。入队后仍 `await triggerBackground` 的触发请求，并返回：

```ts
const accepted = await enqueueGeneration({
  user: { id: ctx.userId, maxConcurrency: ctx.maxConcurrency },
  input: parsed.data,
});
await triggerBackground(accepted.generationId);
return Response.json({ ...accepted, status: "queued" }, { status: 202 });
```

旧浏览器缺 mode 且无 Key会由 Task 1 schema default 为 system；缺 mode/system 携 Key 固定 400。代码至此具备 custom 能力，但缺省开关仍关闭；只有 Task 11 的 migration/env/smoke 通过后才在生产打开。worker 已能解密、零扣费、清凭据且不回退 system。

- [ ] **Step 7: 跑 system/custom 管线、API 契约和钱回归**

Run:

```powershell
npm run test:money -- tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts tests/money/debit.test.ts tests/money/enqueue-custom.test.ts
npm run test:run -- tests/unit/generate-handler.test.ts src/contracts/generate.test.ts src/server/relay.test.ts src/server/generation/failure.test.ts
npm run typecheck
```

Expected: PASS；custom 零 debit/零余额变化/清凭据，system 仍只扣一次且保留旧错误语义；旧 keyless system request 与五字段 accepted 契约通过；所有 callRelay 调用点已显式 mode/deadline。

- [ ] **Step 8: 提交**

```bash
git add src/server/money/preempt.server.ts src/server/generation/process.ts src/server/generation/finalizeCustom.server.ts src/server/generation/feature.server.ts src/server/relay.ts src/contracts/generate.ts netlify/functions/generate.ts tests/unit/generate-handler.test.ts scripts/relay-smoke.ts scripts/relay-edits-call-smoke.ts scripts/relay-chat-probe.ts scripts/relay-edits-probe.ts scripts/relay-format-probe.ts tests/money/pipeline-custom.test.ts tests/money/pipeline.test.ts
git commit -m "feat: finalize custom generations without charging"
```

### 技术蓝图 7：统一五分钟 deadline、批量状态与凭据孤儿清理

**Files:**
- Create: `src/server/generation/deadline.server.ts`
- Create: `src/server/generation/status.server.ts`
- Create: `src/server/generation/status.server.test.ts`
- Create: `tests/unit/generate-status-handler.test.ts`
- Create: `netlify/functions/cron-clean-generation-credentials.ts`
- Create: `tests/unit/cron-clean-generation-credentials.test.ts`
- Create: `tests/money/deadline.test.ts`
- Modify: `src/server/generation/scan.server.ts:1-51`
- Modify: `netlify/functions/generate-status.ts:1-59`
- Modify: `netlify/functions/cron-timeout-rescan.ts:1-24`
- Modify: `netlify.toml`
- Modify: `tests/money/timeout.test.ts:1-44`

本 Task 修改 `netlify.toml` 与 `cron-timeout-rescan.ts` 时，同步把旧“fire-and-forget 触发”注释改为“await 短触发请求、不等待 background job”；只改注释口径，不改变 helper 吞错与 cron 补派语义。

- [ ] **Step 1: 写 queued/claimed/running、owner scope 和终态竞争测试**

创建 `tests/money/deadline.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteExpiredGenerationCredentials,
  encryptCustomApiKey,
} from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { finalizeCustomSuccess } from "../../src/server/generation/finalizeCustom.server";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { chargeOnSuccess } from "../../src/server/money/debit.server";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;
beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

describe("generation deadline", () => {
  it("expires every in-flight state, writes one event, and deletes custom credentials", async () => {
    const uid = await ctx.createUser({ balanceMp: 100 });
    const jobs = await Promise.all(
      ["queued", "claimed", "running"].map((status) =>
        ctx.createGeneration(uid, { status, credentialMode: "custom", deadlineAgoSec: 1 }),
      ),
    );
    for (const job of jobs) {
      const sealed = encryptCustomApiKey("sk-timeout-sentinel");
      await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                    VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,now()+interval '10 minutes')`;
    }
    const expired = await expireDueGenerations({ userId: uid, now: new Date() });
    expect(expired).toHaveLength(3);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
    expect((await ctx.events(uid, "image_failed")).filter((event) => JSON.stringify(event).includes("provider_timeout"))).toHaveLength(3);
    for (const job of jobs) expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect(await expireDueGenerations({ userId: uid, now: new Date() })).toHaveLength(0);
  });

  it("status read closes only the requesting owner jobs", async () => {
    const owner = await ctx.createUser();
    const other = await ctx.createUser();
    const ownJob = await ctx.createGeneration(owner, { deadlineAgoSec: 1 });
    const otherJob = await ctx.createGeneration(other, { deadlineAgoSec: 1 });
    const items = await loadGenerationStatuses(owner, [ownJob.generationId, otherJob.generationId]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ generationId: ownJob.generationId, status: "failed", errorCode: "provider_timeout" });
    expect((await ctx.gen(otherJob.generationId))?.status).toBe("queued");
  });

  it("deletes an expired 10 minute orphan credential without changing a fresh generation", async () => {
    const uid = await ctx.createUser();
    const job = await ctx.createGeneration(uid, { credentialMode: "custom" });
    const sealed = encryptCustomApiKey("sk-orphan");
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,now()-interval '1 second')`;
    expect(await deleteExpiredGenerationCredentials(new Date())).toBe(1);
    expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect((await ctx.gen(job.generationId))?.status).toBe("queued");
  });

  it.each(["system", "custom"] as const)("allows exactly one terminal when %s success races timeout", async (mode) => {
    const uid = await ctx.createUser({ balanceMp: 10_000 });
    const job = await ctx.createGeneration(uid, { status: "running", credentialMode: mode, deadlineAgoSec: 1 });
    const input = {
      generationId: job.generationId,
      userId: uid,
      storageKey: `race/${job.generationId}.png`,
      publicUrl: `https://img.test/${job.generationId}.png`,
      contentType: "image/png",
      width: 1,
      height: 1,
      sizeBytes: 70,
    };
    const success = mode === "custom" ? finalizeCustomSuccess(input) : chargeOnSuccess(input);
    await Promise.allSettled([
      success,
      expireDueGenerations({ generationIds: [job.generationId], now: new Date() }),
    ]);
    const generation = await ctx.gen(job.generationId);
    expect(["succeeded", "failed"]).toContain(generation?.status);
    const images = await ctx.images(job.generationId);
    const debits = await ctx.ledger(uid, "debit");
    if (generation?.status === "failed") {
      expect(images).toHaveLength(0);
      expect(debits).toHaveLength(0);
    } else {
      expect(images).toHaveLength(1);
      expect(debits).toHaveLength(mode === "system" ? 1 : 0);
    }
    expect((await ctx.events(uid, "image_succeeded")).length + (await ctx.events(uid, "image_failed")).length).toBe(1);
  });
});
```

创建 `src/server/generation/status.server.test.ts`：

```ts
// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GenerateStatusBatchResponse } from "../../contracts/generate";
import { parseGenerationStatusQuery } from "./status.server";

describe("status query parsing", () => {
  it("keeps single-id compatibility and deduplicates a batch", () => {
    const first = randomUUID();
    const second = randomUUID();
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?id=${first}`)).toEqual({
      ok: true,
      single: true,
      ids: [first],
    });
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?ids=${first},${first},${second}`)).toEqual({
      ok: true,
      single: false,
      ids: [first, second],
    });
  });

  it("keeps missing ids explicit without distinguishing absent from foreign", () => {
    const id = randomUUID();
    expect(GenerateStatusBatchResponse.parse({ items: [], missingIds: [id] }).missingIds).toEqual([id]);
  });

  it("rejects both parameters, malformed UUIDs, and more than 50 ids", () => {
    const ids = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?id=${randomUUID()}&ids=${randomUUID()}`).ok).toBe(false);
    expect(parseGenerationStatusQuery("https://site.test/api/generate-status?ids=not-a-uuid").ok).toBe(false);
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?ids=${ids}`).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试并确认 helper 不存在**

Run: `npm run test:money -- tests/money/deadline.test.ts`

Expected: FAIL，无法导入 deadline/status server helper。

Run: `npm run test:run -- src/server/generation/status.server.test.ts`

Expected: FAIL，`parseGenerationStatusQuery` 尚不存在。

- [ ] **Step 3: 用单条 set-based SQL 实现原子 deadline 收口**

创建 `src/server/generation/deadline.server.ts`：

```ts
import { getSql } from "../../db/db.server";

export interface ExpireDueArgs {
  generationIds?: string[];
  userId?: string;
  now?: Date;
}

export async function expireDueGenerations(args: ExpireDueArgs = {}): Promise<Array<{ id: string; userId: string }>> {
  const ids = args.generationIds?.length ? args.generationIds : null;
  const injectedNow = args.now?.toISOString() ?? null;
  const rows = await getSql()`
    WITH clock AS (
      SELECT COALESCE(${injectedNow}::timestamptz, now()) AS at
    ),
    expired AS (
      UPDATE generations
      SET status='failed',error_code='provider_timeout',
          error='请求超时，本站未扣积分，请重试',http_status=NULL,credits_charged_mp=0,
          completed_at=clock.at,
          duration_ms=CASE WHEN started_at IS NULL THEN NULL
                           ELSE (EXTRACT(EPOCH FROM (clock.at-started_at))*1000)::int END,
          updated_at=clock.at
      FROM clock
      WHERE status IN ('queued','claimed','running') AND deadline_at<=clock.at
        AND (${ids}::uuid[] IS NULL OR id=ANY(${ids}::uuid[]))
        AND (${args.userId ?? null}::uuid IS NULL OR user_id=${args.userId ?? null}::uuid)
      RETURNING generations.id,generations.user_id,generations.credential_mode
    ),
    deleted_credentials AS (
      DELETE FROM generation_credentials c
      USING expired e
      WHERE c.generation_id=e.id
      RETURNING c.generation_id
    ),
    inserted_events AS (
      INSERT INTO events(type,user_id,payload)
      SELECT 'image_failed',user_id,
             jsonb_build_object('generationId',id,'reason','provider_timeout','credentialMode',credential_mode)
      FROM expired
      RETURNING id
    )
    SELECT id,user_id FROM expired`;
  return rows.map((row) => ({ id: row.id as string, userId: row.user_id as string }));
}
```

`duration_ms` 始终表示 provider worker 从 `started_at` 到终态的执行时长，不包含排队时间；queued/claimed 尚无 `started_at` 的 deadline 收口保持 null。若需要端到端时长，另建指标，不能复用该列。

生产调用不传 `args.now`，由 SQL `now()` 提供权威数据库时钟；只有 money test 传入虚拟时间。不得把默认值改回 `new Date()`，否则应用主机漂移会提前或延后终态收口。

该语句没有“先查再逐行循环”的竞态与 N+1；UPDATE、credential delete 和 event insert 在一个数据库语句中原子完成。无到期行时返回空数组。

- [ ] **Step 4: 同批增加 status 契约与 owner-scoped 状态读取**

在 `src/contracts/generate.ts` 此时才替换 status 联合并新增 batch：

```ts
const statusIdentity = {
  generationId: z.uuid(),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.iso.datetime(),
};

export const GenerateStatusResponse = z.discriminatedUnion("status", [
  z.object({
    ...statusIdentity,
    status: z.enum(["queued", "claimed", "running"]),
    startedAt: z.iso.datetime().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("succeeded"),
    image: z.object({
      publicUrl: z.url(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
    creditsChargedMp: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("failed"),
    errorCode: z.enum(ERROR_CODES),
    error: z.string(),
    httpStatus: z.number().int().nullable(),
    creditsChargedMp: z.literal(0),
  }),
]);
export type GenerateStatusResponse = z.infer<typeof GenerateStatusResponse>;

export const GenerateStatusBatchResponse = z.object({
  items: z.array(GenerateStatusResponse).max(50),
  missingIds: z.array(z.uuid()).max(50),
});
export type GenerateStatusBatchResponse = z.infer<typeof GenerateStatusBatchResponse>;
```

创建 `src/server/generation/status.server.ts`，先调用 `expireDueGenerations({generationIds,userId})`，再用一条 `WHERE g.id=ANY($ids) AND g.user_id=$userId` 查询。映射函数必须返回 Task 1 的联合字段：

```ts
import type { ErrorCode, GenerateStatusResponse } from "../../contracts/generate";
import { getSql } from "../../db/db.server";
import { z } from "zod";
import { expireDueGenerations } from "./deadline.server";

export type StatusQueryResult =
  | { ok: true; single: boolean; ids: string[] }
  | { ok: false };

export function parseGenerationStatusQuery(rawUrl: string): StatusQueryResult {
  const params = new URL(rawUrl).searchParams;
  const id = params.get("id");
  const rawIds = params.get("ids");
  if ((id && rawIds) || (!id && !rawIds)) return { ok: false };
  const ids = [...new Set(id ? [id] : (rawIds as string).split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > 50 || ids.some((value) => !z.uuid().safeParse(value).success)) {
    return { ok: false };
  }
  return { ok: true, single: Boolean(id), ids };
}

export async function loadGenerationStatuses(userId: string, ids: string[]): Promise<GenerateStatusResponse[]> {
  const uniqueIds = [...new Set(ids)].slice(0, 50);
  if (uniqueIds.length === 0) return [];
  await expireDueGenerations({ generationIds: uniqueIds, userId });
  const rows = await getSql()`SELECT g.id,g.credential_mode,g.deadline_at,g.status,g.started_at,g.created_at,
                                    g.error_code,g.error,g.http_status,g.duration_ms,g.credits_charged_mp,
                                    i.public_url,i.width,i.height
                             FROM generations g LEFT JOIN images i ON i.generation_id=g.id
                             WHERE g.id=ANY(${uniqueIds}::uuid[]) AND g.user_id=${userId}`;
  return rows.map((row) => {
    const identity = {
      generationId: row.id as string,
      credentialMode: row.credential_mode as "system" | "custom",
      deadlineAt: new Date(row.deadline_at as string).toISOString(),
    };
    if (row.status === "succeeded") {
      return {
        ...identity,
        status: "succeeded" as const,
        image: { publicUrl: row.public_url as string, width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height) },
        creditsChargedMp: Number(row.credits_charged_mp),
        durationMs: Number(row.duration_ms ?? 0),
      };
    }
    if (row.status === "failed") {
      return {
        ...identity,
        status: "failed" as const,
        errorCode: row.error_code as ErrorCode,
        error: String(row.error ?? "生成失败，请重试"),
        httpStatus: row.http_status == null ? null : Number(row.http_status),
        creditsChargedMp: 0 as const,
      } as GenerateStatusResponse;
    }
    const startedAt = row.started_at ? new Date(row.started_at as string).toISOString() : undefined;
    return {
      ...identity,
      status: row.status as "queued" | "claimed" | "running",
      startedAt,
      elapsedMs: row.started_at ? Math.max(0, Date.now() - new Date(row.started_at as string).getTime()) : undefined,
    };
  });
}
```

- [ ] **Step 5: 改造单项兼容 + 批量 status handler**

`netlify/functions/generate-status.ts` 调用同一个 parser：

```ts
const query = parseGenerationStatusQuery(req.url);
if (!query.ok) return httpError(400, "INVALID_PARAM", "任务 ID 无效");
const items = await loadGenerationStatuses(ctx.userId, query.ids);
if (query.single) {
  if (items.length === 0) return httpError(404, "NOT_FOUND", "任务不存在");
  return Response.json(items[0]);
}
const found = new Set(items.map((item) => item.generationId));
const missingIds = query.ids.filter((id) => !found.has(id));
return Response.json({ items, missingIds });
```

新增 `parseGenerationStatusQuery/loadGenerationStatuses` imports。单项缺失/非 owner 统一 404；批量把二者统一放进 `missingIds`，只回显调用者本来就提交的 ID，不泄露存在性。Task 9 负责刷新会话并收口仍缺失的乐观项。

创建 `tests/unit/generate-status-handler.test.ts`（node environment），mock 鉴权与 `loadGenerationStatuses`，精确覆盖：非法/双参数时 400 且 loader 未调用；单 ID 命中返回单对象；单 ID absent/foreign 统一 404；批量仅把 owner items 放入 `items`，并按请求顺序把 foreign/absent 放入 `missingIds`。测试不得根据 loader 未返回的 ID 猜测“foreign”或“absent”。

- [ ] **Step 6: 让 cron 共用 helper，并落实 10 分钟 TTL + 5 分钟调度**

`src/server/generation/scan.server.ts` 的 `rescanTimeouts` 改为 `return expireDueGenerations()`；`dispatchStaleQueued` 查询增加 `deadline_at>now()`。

创建 `netlify/functions/cron-clean-generation-credentials.ts`：

```ts
import { alert } from "../../src/server/alert.server";
import { deleteExpiredGenerationCredentials } from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const expiredJobs = await expireDueGenerations();
    const deletedCredentials = await deleteExpiredGenerationCredentials();
    return Response.json({ ok: true, expiredJobs: expiredJobs.length, deletedCredentials });
  } catch (error) {
    await captureException(error, { cron: "clean-generation-credentials" });
    await alert("cron_failed", { cron: "clean-generation-credentials" });
    return new Response("cron error", { status: 500 });
  }
}
```

在 `netlify.toml` 增加：

```toml
[functions."cron-clean-generation-credentials"]
  schedule = "*/5 * * * *"
```

创建 `tests/unit/cron-clean-generation-credentials.test.ts`（node environment），mock `expireDueGenerations`、`deleteExpiredGenerationCredentials`、`captureException` 和 `alert`：成功时断言 JSON 数量来自两个 helper；任一 helper 抛错时断言 capture 与 `cron_failed` alert 各调用一次、响应 500，且 console/响应不含注入的错误 sentinel。

- [ ] **Step 7: 跑 deadline、旧 timeout 与 cron smoke**

Run: `npm run test:money -- tests/money/deadline.test.ts tests/money/timeout.test.ts`

Expected: PASS；旧 timeout 测试需改为写 `deadline_at=now()-interval '1 second'`，不再复制旧 `started_at<5min` SQL。

Run: `npm run test:run -- src/server/generation/status.server.test.ts`

Expected: PASS；单 ID、去重、非法 UUID、双参数和 51 IDs 全部覆盖。

先让 `scripts/cron-smoke.ts` 调用 Task 0 的 test-env guard，保存/恢复所有会改写的 app_config 值；再运行：

Run: `node --import tsx scripts/test-env-guard.ts scripts/cron-smoke.ts`

Expected: exit 0；新增 deadline 三状态、system/custom 成功竞态、10 分钟 expires 与“5 分钟 cron 最坏不超过 15 分钟”边界、凭据清理检查并全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/contracts/generate.ts src/server/generation/deadline.server.ts src/server/generation/status.server.ts src/server/generation/status.server.test.ts src/server/generation/scan.server.ts netlify/functions/generate-status.ts netlify/functions/cron-timeout-rescan.ts netlify/functions/cron-clean-generation-credentials.ts netlify.toml tests/money/deadline.test.ts tests/money/timeout.test.ts scripts/cron-smoke.ts
git commit -m "feat: enforce generation deadlines and batch status"
```

### 技术蓝图 8：增加顶部 Key 弹窗和响应式本地模式状态

**Files:**
- Create: `src/hooks/useUserApiConfig.ts`
- Create: `src/components/shell/ApiKeyModal.tsx`
- Create: `src/components/shell/ApiKeyModal.module.css`
- Create: `src/components/shell/ApiKeyModal.test.tsx`

- [ ] **Step 1: 写弹窗行为失败测试**

创建 `src/components/shell/ApiKeyModal.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserApiConfig } from "../../lib/userApiConfig";
import { ApiKeyModal } from "./ApiKeyModal";

describe("ApiKeyModal", () => {
  beforeEach(() => localStorage.clear());

  it("saves custom, retains it when switching system, and clears explicitly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const first = render(<ApiKeyModal userId="user-a" onClose={onClose} />);
    expect(screen.getByRole("radio", { name: "系统 Key" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "自定义 Key" }));
    await user.type(screen.getByLabelText("自定义 Key"), "  sk-local-plain  ");
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", customApiKey: "sk-local-plain" });
    expect(onClose).toHaveBeenCalledOnce();

    first.unmount();
    render(<ApiKeyModal userId="user-a" onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "系统 Key" }));
    expect(loadUserApiConfig("user-a").customApiKey).toBe("sk-local-plain");
    await user.click(screen.getByRole("button", { name: "清除自定义 Key" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", customApiKey: "" });
  });

  it("shows the fixed read-only URL and validates blank input locally", async () => {
    const user = userEvent.setup();
    render(<ApiKeyModal userId="user-a" onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: "自定义 Key" }));
    expect(screen.getByDisplayValue("https://api.tangguo.xin/v1")).toHaveAttribute("readOnly");
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义 Key");
  });

  it("traps focus, closes with Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(<ApiKeyModal userId="user-a" onClose={onClose} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "自定义 Key" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
```

- [ ] **Step 2: 运行测试并确认组件不存在**

Run: `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx`

Expected: FAIL，无法导入 `ApiKeyModal`。

- [ ] **Step 3: 实现 React 配置 hook**

创建 `src/hooks/useUserApiConfig.ts`：

```ts
import { useCallback, useEffect, useState } from "react";
import {
  clearUserApiConfig,
  loadUserApiConfig,
  saveUserApiConfig,
  USER_API_CONFIG_EVENT,
  userApiConfigStorageKey,
  type UserApiConfig,
} from "../lib/userApiConfig";

export function useUserApiConfig(userId: string | undefined) {
  const fallback = (): UserApiConfig => ({ mode: "system", customApiKey: "" });
  const [snapshot, setSnapshot] = useState<{
    userId: string | undefined;
    config: UserApiConfig;
    ready: boolean;
  }>({ userId: undefined, config: fallback(), ready: false });
  const matches = snapshot.userId === userId;
  const config = matches ? snapshot.config : fallback();
  const ready = Boolean(userId && matches && snapshot.ready);

  useEffect(() => {
    setSnapshot({ userId, config: fallback(), ready: false });
    if (!userId) return;
    const reload = () => setSnapshot({ userId, config: loadUserApiConfig(userId), ready: true });
    const onStorage = (event: StorageEvent) => {
      if (event.key === userApiConfigStorageKey(userId)) reload();
    };
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId === userId) reload();
    };
    reload();
    window.addEventListener("storage", onStorage);
    window.addEventListener(USER_API_CONFIG_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(USER_API_CONFIG_EVENT, onLocal);
    };
  }, [userId]);

  const persist = useCallback(
    (value: UserApiConfig) => {
      if (!userId) return;
      saveUserApiConfig(userId, value);
      setSnapshot({ userId, config: value, ready: true });
    },
    [userId],
  );
  const clear = useCallback(() => {
    if (!userId) return;
    clearUserApiConfig(userId);
    setSnapshot({ userId, config: fallback(), ready: true });
  }, [userId]);
  return { config, ready, persist, clear };
}
```

- [ ] **Step 4: 实现可访问的 modal**

创建 `src/components/shell/ApiKeyModal.tsx`：

```tsx
import { Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  CUSTOM_RELAY_BASE_URL,
  MAX_CUSTOM_API_KEY_LENGTH,
} from "../../lib/userApiConfig";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useUserApiConfig } from "../../hooks/useUserApiConfig";
import styles from "./ApiKeyModal.module.css";

export function ApiKeyModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { config, ready, persist, clear } = useUserApiConfig(userId);
  const [mode, setMode] = useState(config.mode);
  const [apiKey, setApiKey] = useState(config.customApiKey);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.activeElement as HTMLElement | null,
  );
  useLockBodyScroll(true);

  useEffect(() => {
    if (!ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    closeRef.current?.focus();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, ready]);

  useEffect(() => {
    if (!ready) return;
    setMode(config.mode);
    setApiKey(config.customApiKey);
  }, [ready, config.mode, config.customApiKey]);

  const selectMode = (next: "system" | "custom") => {
    setMode(next);
    setError("");
    if (next === "system") persist({ mode: "system", customApiKey: apiKey });
  };

  const save = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return setError("请输入自定义 Key");
    if (trimmed.length > MAX_CUSTOM_API_KEY_LENGTH) return setError("自定义 Key 不能超过 500 个字符");
    persist({ mode: "custom", customApiKey: trimmed });
    onClose();
  };

  const remove = () => {
    clear();
    setMode("system");
    setApiKey("");
    setError("");
  };

  if (!ready) return null;
  return (
    <div className={styles.scrim} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.header}>
          <h2 id={titleId}><KeyRound size={18} />生图 Key</h2>
          <button ref={closeRef} type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className={styles.segment} role="radiogroup" aria-label="Key 模式">
          <label><input type="radio" name="credential-mode" checked={mode === "system"} onChange={() => selectMode("system")} />系统 Key</label>
          <label><input type="radio" name="credential-mode" checked={mode === "custom"} onChange={() => setMode("custom")} />自定义 Key</label>
        </div>
        <p className={styles.description}>{mode === "system" ? "使用系统 Key，成功后按积分计费。" : "使用你的 Key，本站不扣积分；第三方计费以服务商规则为准。"}</p>
        {mode === "custom" ? (
          <div className={styles.fields}>
            <label htmlFor="custom-api-key">自定义 Key</label>
            <div className={styles.secretField}>
              <input id="custom-api-key" type={visible ? "text" : "password"} value={apiKey} maxLength={MAX_CUSTOM_API_KEY_LENGTH} onChange={(event) => { setApiKey(event.target.value); setError(""); }} autoComplete="off" />
              <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏 Key" : "显示 Key"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            <label htmlFor="custom-base-url">Base URL</label>
            <input id="custom-base-url" value={CUSTOM_RELAY_BASE_URL} readOnly />
            <span className={styles.readonlyHint}>固定地址，不可修改</span>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        ) : null}
        <footer className={styles.actions}>
          <button type="button" className={styles.clear} onClick={remove} disabled={!apiKey}><Trash2 size={16} />清除自定义 Key</button>
          {mode === "custom" ? <button type="button" className={styles.save} onClick={save}>保存并使用</button> : null}
        </footer>
      </section>
    </div>
  );
}
```

`ApiKeyModal.module.css` 使用已有 tokens，稳定尺寸至少包含：

```css
.scrim { position: fixed; inset: 0; z-index: var(--z-modal, 80); display: grid; place-items: center; padding: 16px; background: var(--scrim); }
.dialog { width: min(360px, 100%); max-height: calc(100dvh - 32px); overflow: auto; padding: var(--space-5); border: .5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); box-shadow: var(--shadow-lg); }
.header,.actions,.secretField { display: flex; align-items: center; }
.header,.actions { justify-content: space-between; gap: var(--space-3); }
.header h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 16px; letter-spacing: 0; }
.iconButton,.secretField button { width: 36px; height: 36px; display: grid; place-items: center; border: 0; background: transparent; color: var(--text-secondary); }
.segment { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 4px; margin-top: var(--space-4); padding: 4px; border: .5px solid var(--border-subtle); border-radius: 8px; }
.segment label { min-width: 0; padding: 8px; text-align: center; font-size: 13px; }
.description,.readonlyHint { color: var(--text-tertiary); font-size: 12px; }
.fields { display: grid; gap: var(--space-2); }
.fields input { width: 100%; min-width: 0; height: 40px; padding: 0 12px; border: .5px solid var(--border-strong); border-radius: 8px; background: var(--bg-surface); color: var(--text-primary); }
.secretField input { padding-right: 40px; }
.secretField button { margin-left: -40px; flex: 0 0 40px; }
.error { margin: 0; color: var(--danger-text); font-size: 12px; }
.actions { margin-top: var(--space-5); flex-wrap: wrap; }
.clear,.save { min-height: 38px; display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; border-radius: 8px; }
.save { margin-left: auto; border: 0; background: var(--primary-bg); color: var(--primary-fg); }
@media (max-width: 380px) { .actions > button { width: 100%; justify-content: center; } .save { margin-left: 0; } }
```

- [ ] **Step 5: 保持 Modal 不可达直到 Composer 同批接入**

本 Task 不修改 `TopBar`，不渲染 `ApiKeyModal`。组件、hook 与测试可构建但用户没有入口，避免出现“已选 custom、实际请求仍是 system”的误导中间版本。Task 9 将在同一提交里挂载 TopBar、打开空 Key Modal，并把 ready/config 接入 Composer。

- [ ] **Step 6: 运行组件测试、类型和构建**

Run: `npm run test:run -- src/components/shell/ApiKeyModal.test.tsx src/lib/userApiConfig.test.ts`

Expected: PASS。

Run:

```powershell
npm run typecheck
npm run build
```

Expected: typecheck/build exit 0；Modal 单元行为通过，但应用页面中搜索不到 `<ApiKeyModal` 挂载点。

- [ ] **Step 7: 提交**

```bash
git add src/hooks/useUserApiConfig.ts src/components/shell/ApiKeyModal.tsx src/components/shell/ApiKeyModal.module.css src/components/shell/ApiKeyModal.test.tsx
git commit -m "feat: add user key mode settings"
```

### 技术蓝图 9：原子接入 Key 入口、mode-aware 提交和多任务轮询

**Files:**
- Create: `src/lib/generationBatch.ts`
- Create: `src/lib/generationBatch.test.ts`
- Create: `src/components/conversation/ConversationView.keyModes.test.tsx`
- Create: `src/components/shell/TopBar.keyModes.test.tsx`
- Modify: `src/contracts/conversation.ts:18-44`
- Modify: `src/contracts/me.ts:1-18`
- Modify: `src/hooks/useGeneration.ts:1-121`
- Modify: `src/hooks/useGenerationStatus.ts:1-28`
- Modify: `src/components/conversation/ConversationView.tsx:1-328`
- Modify: `src/components/composer/Composer.tsx:1-328`
- Modify: `src/components/shell/TopBar.tsx:1-92`
- Modify: `src/components/shell/TopBar.module.css:1-112`
- Modify: `src/components/shell/ApiKeyModal.tsx`
- Modify: `src/components/shell/ApiKeyModal.test.tsx`
- Modify: `src/server/reads.server.ts:86-127`
- Modify: `src/phase1.test.tsx`

本 Task 是唯一的前端启用边界，必须作为一个原子提交完成。入口、配置 `ready`、请求 mode、空 Key 弹窗、system 旧锁、多任务轮询任一未完成时都不得合并或部署。

- [ ] **Step 1: 写 pending、50 项分块和终态合并失败测试**

创建 `src/lib/generationBatch.test.ts`。测试至少覆盖：

```ts
import { describe, expect, it } from "vitest";
import type { ConversationGeneration } from "../contracts/conversation";
import {
  chunkGenerationIds,
  pendingGenerationIds,
  terminalStatusSignature,
} from "./generationBatch";

const turn = (id: string, status: ConversationGeneration["status"], mode: "system" | "custom" = "custom"): ConversationGeneration => ({
  id,
  prompt: id,
  size: "auto",
  quality: null,
  background: null,
  credentialMode: mode,
  deadlineAt: "2026-07-11T12:05:00.000Z",
  status,
  errorCode: null,
  error: null,
  httpStatus: null,
  creditsChargedMp: 0,
  durationMs: null,
  createdAt: "2026-07-11T12:00:00.000Z",
  image: null,
});

describe("generation batch", () => {
  it("tracks every in-flight turn, not only the first", () => {
    expect(pendingGenerationIds([turn("a", "running"), turn("b", "queued"), turn("c", "succeeded")])).toEqual(["a", "b"]);
  });

  it("splits 101 unique ids into requests of at most 50", () => {
    const chunks = chunkGenerationIds(Array.from({ length: 101 }, (_, index) => `g-${index}`));
    expect(chunks.map((chunk) => chunk.length)).toEqual([50, 50, 1]);
    expect(new Set(chunks.flat()).size).toBe(101);
  });

  it("changes the terminal signature for any completed item", () => {
    expect(terminalStatusSignature([{ generationId: "a", status: "succeeded" }, { generationId: "b", status: "running" }])).toBe("a:succeeded");
  });
});
```

- [ ] **Step 2: 运行测试并确认 helper 不存在**

Run: `npm run test:run -- src/lib/generationBatch.test.ts`

Expected: FAIL，无法导入 `generationBatch`。

- [ ] **Step 3: 实现稳定 pending 与分块 helper**

创建 `src/lib/generationBatch.ts`：

```ts
import type { ConversationGeneration } from "../contracts/conversation";

export function pendingGenerationIds(turns: ConversationGeneration[]): string[] {
  return turns
    .filter((turn) => turn.status === "queued" || turn.status === "claimed" || turn.status === "running")
    .map((turn) => turn.id);
}

export function chunkGenerationIds(ids: string[], limit = 50): string[][] {
  const unique = [...new Set(ids)].sort();
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += limit) chunks.push(unique.slice(index, index + limit));
  return chunks;
}

export function terminalStatusSignature(items: Array<{ generationId: string; status: string }>): string {
  return items
    .filter((item) => item.status === "succeeded" || item.status === "failed")
    .map((item) => `${item.generationId}:${item.status}`)
    .sort()
    .join("|");
}
```

`limit` 小于 1 时抛 `RangeError`，并补一条测试，避免以后配置错误形成死循环。

- [ ] **Step 4: 提交时冻结配置快照，并用 202 权威值校正乐观任务**

`src/hooks/useGeneration.ts` 改用 `GenerateParams`，签名固定为：

```ts
(params: GenerateParams, apiConfig: UserApiConfig, file: File | null = null, onAccepted?: () => void) => void
```

调用瞬间复制 `apiConfig`，上传期间切换模式不得改变本次请求。乐观 turn 暂用客户端 `createdAt + 5min` 只为即时展示，并增加 `credentialMode`；POST 必须条件展开，system body 绝不能出现 `customApiKey` 或 `baseUrl`：

```ts
const credentialFields =
  apiConfig.mode === "custom"
    ? { credentialMode: "custom" as const, customApiKey: apiConfig.customApiKey }
    : { credentialMode: "system" as const };
const accepted = await apiPost(
  "/api/generate",
  { ...params, ...credentialFields, conversationId: cid, generationId: gid, inputImageKey },
  GenerateAcceptedResponse,
);
qc.setQueryData<ConversationDetail>(["conversation", accepted.conversationId], (old) =>
  old
    ? {
        ...old,
        generations: old.generations.map((generation) =>
          generation.id === accepted.generationId
            ? { ...generation, credentialMode: accepted.credentialMode, deadlineAt: accepted.deadlineAt }
            : generation,
        ),
      }
    : old,
);
```

随后才 invalidate 会话和会话列表。`submittingRef` 只锁当前上传/入队到 202 或错误，finally 立即释放；不得锁到 generation 终态。新增 hook 测试证明 system payload 无 Key、custom payload 有 Key 且无 `baseUrl`、服务器 `deadlineAt` 会覆盖客户端乐观值。

若已打开页面提交 custom 时 API 返回 `503 CUSTOM_KEY_MODES_DISABLED`，错误分支必须立即把 Query cache 的 `["me"]` 中 `customKeyModesEnabled` 置为 false 并 invalidate `["me"]`，撤销本次乐观 turn、打开暂停态 Modal，保留本地 Key，且绝不自动重试为 system。这样生产紧急关开关后，无需整页刷新也会在首次 503 后停止后续 custom 提交。

- [ ] **Step 5: 用一个 Query 时钟驱动任意数量的分块状态请求**

`useGenerationStatuses(generationIds)` 只创建一个 `useQuery`；`queryFn` 内对 `chunkGenerationIds(ids)` 的每块发一个 `<=50` 请求并合并 `items`/`missingIds`：

```ts
async function loadStatusChunks(ids: string[]) {
  const responses = await Promise.all(
    chunkGenerationIds(ids).map((chunk) =>
      apiGet(
        `/api/generate-status?ids=${encodeURIComponent(chunk.join(","))}`,
        GenerateStatusBatchResponse,
      ),
    ),
  );
  return {
    items: responses.flatMap((response) => response.items),
    missingIds: [...new Set(responses.flatMap((response) => response.missingIds))].sort(),
  };
}
```

Query key 使用排重排序后的 IDs；有 pending IDs 时固定每 2 秒刷新并允许后台刷新。**不得**因客户端 `Date.now()`、本地 deadline、某一块全终态或临时网络错误停止轮询；只有会话权威数据已不含任何 pending ID 时 `enabled=false`。保留单 ID compatibility wrapper 仅供真实残余调用点，ConversationView 只能调用一次 batch hook。

- [ ] **Step 6: 接入读取契约、终态恢复、missingIds 和 deadline 展示兜底**

`ConversationGeneration` 增加必填 `credentialMode`/`deadlineAt`，`MeResponse` 增加必填 `customKeyModesEnabled`；`loadMe` 通过 server-only `isCustomKeyModesEnabled()` 返回开关，不把任何 Key/env 值下发。`reads.server.ts` 查询并映射 `g.credential_mode,g.deadline_at`。ConversationView：

```ts
const userId = me.data?.user.id;
const customKeyModesEnabled = me.data?.customKeyModesEnabled === true;
const { config: apiConfig, ready: apiConfigReady } = useUserApiConfig(userId);
const pendingTurns = turns.filter((turn) => ["queued", "claimed", "running"].includes(turn.status));
const pendingSystemTurns = pendingTurns.filter((turn) => turn.credentialMode === "system");
const generationStatuses = useGenerationStatuses(pendingTurns.map((turn) => turn.id));
const terminalSignature = terminalStatusSignature(generationStatuses.data?.items ?? []);
const canAfford = apiConfig.mode === "custom" ? customKeyModesEnabled : balanceMp >= priceMp;
const submissionBlocked = !apiConfigReady || isSubmitting ||
  (apiConfig.mode === "custom" && !customKeyModesEnabled) ||
  (apiConfig.mode === "system" && pendingSystemTurns.length > 0);
```

终态签名变化时 invalidate 当前会话；仅 system succeeded 刷余额，任一 succeeded 刷资产。`missingIds` 连续两个响应仍出现时先 invalidate 当前会话。权威会话 refetch 成功后若该 ID 仍不存在，把原乐观 turn 从 pending 集合移除，并在当前页面的 `missingTombstones` UI-only 状态中保留其 prompt/createdAt，显示固定“任务不存在或无权访问”；不得向服务端写终态、不得伪造扣费或 generation error code。若 refetch 找回该 generation，则清除计数并采用服务端行。tombstone ID 停止轮询，其余 pending ID 继续；切换会话清理 tombstone。

删除旧 `pendingTurn/pendingId/forceTick/TIMEOUT_MS` 单项逻辑。按最近的 `deadlineAt` 设置纯展示定时器；到 `deadlineAt + 10s` 仍无服务端终态时，该卡停止动画并显示“状态确认中，请重试刷新”，同时继续批量轮询和会话刷新。服务端返回 `provider_timeout` 后改为精确文案“请求超时，本站未扣积分；第三方计费以服务商规则为准”。浏览器时间只控制展示，绝不能写终态或停止恢复。

- [ ] **Step 7: 同批挂载 TopBar 入口与可访问 Modal**

`TopBarProps` 增加可选 `onOpenKeySettings` 与迁移期内部门禁 `enableKeySettings?: boolean`，后者在 P9-23 前默认 `false`。门禁为 true 时，TopBar 使用 `useUserApiConfig(me.data?.user.id)` 显示一个固定 36px 的 `KeyRound` 图标按钮：配置未 ready 时 disabled；ready 后 `aria-label`/`title` 分别为“生图 Key 设置：当前系统 Key”“生图 Key 设置：当前自定义 Key”或“生图 Key 设置：自定义 Key 已暂停”。当父级没传回调时 TopBar 自己维护 modal open 状态并渲染 `ApiKeyModal`。P9-23 在 Composer、请求和轮询全部接好后同批删除这个迁移门禁并让所有受保护页面的 TopBar 无条件提供入口；不得部署门禁仍为 false 的半成品，也不得提前把默认值改 true。

`ApiKeyModal` 接收 `customEnabled`：关闭时禁用 custom radio/保存按钮并显示“自定义 Key 暂停使用，可切换系统 Key”；不得清除用户已保存的 Key，也不得静默改成 system 后发起扣积分请求。system 选项始终可用。

ConversationView 自己维护 `keyModalOpen`，把打开回调传给欢迎态和工作态的 TopBar，并在同一父级渲染 Modal。这样 custom Key 为空时可直接 `setKeyModalOpen(true)`，而不是只 toast：

```ts
if (!apiConfigReady) return;
if (apiConfig.mode === "custom" && !customKeyModesEnabled) {
  setKeyModalOpen(true);
  return;
}
if (apiConfig.mode === "system" && pendingSystemTurns.length > 0) return;
if (apiConfig.mode === "system" && balanceMp < priceMp) return toast.error("积分不足，去充值");
if (apiConfig.mode === "custom" && !apiConfig.customApiKey.trim()) {
  setKeyModalOpen(true);
  return;
}
submit(req, apiConfig, file, onAccepted);
```

`bringBackPrompt`/`regenerate` 使用同一 `submissionBlocked`，因此 system 保留现有“前一张终态前锁定”交互；custom 只在当前 enqueue 中锁定，202 后可继续提交。TopBar CSS 在 360/768/1024/1440px 都保持图标、积分和本次计数不溢出。新增 TopBar 测试覆盖 ready 前禁用、当前 mode 标签、入口打开与焦点恢复。

- [ ] **Step 8: 更新 Composer 的 mode-aware 计费与 Enter 行为**

`ComposerProps.request/onChange` 改为 `GenerateParams`，新增 `credentialMode: CredentialMode`。父级传 `disabled={submissionBlocked}`。发送按钮与 Enter 使用同一判断：system 余额不足才去充值；已启用 custom 不看本站余额且显示“使用自定义 Key · 本站不扣积分”；custom 开关关闭时显示“自定义 Key 暂停使用”且不导航充值页。配置尚未 ready 时发送、Enter、上传和参数控件均 disabled，避免 hydration 首帧误用 system。

失败文案覆盖 Task 1 的 system/custom 并集；custom 的 quota、429、5xx、timeout、storage 失败均明确“本站未扣积分；第三方计费以服务商规则为准”，不得写成完全“未扣费”。

- [ ] **Step 9: 写组件集成回归并运行全部前端门禁**

`ConversationView.keyModes.test.tsx` 至少断言：

- config 未 ready 时不能提交；空 custom Key 打开 Modal。
- 初始 `/api/me` 为 true、随后 custom POST 返回 `CUSTOM_KEY_MODES_DISABLED` 时，立即切成暂停 UI、保留本地 Key、移除乐观 turn、invalidate me，且没有第二次 system POST。
- system 有 pending 时 Composer 仍锁定；custom 有至少 3 个 pending 时 202 后可继续提交。
- system payload 不含 Key；custom payload 不含可编辑 Base URL。
- 三个任务乱序终态能逐项刷新；51 个 pending 产生 2 个 status 请求。
- 同一 ID 连续两次 missing 后触发权威 refetch；仍缺失则显示“任务不存在或无权访问” tombstone 并停止只轮询该 ID，其他任务继续；refetch 找回时不得误收口。
- 客户端 deadline 过期只改变展示、不停止状态请求；202 的服务器 deadline 被采用。

Run:

```powershell
npm run test:run -- src/lib/generationBatch.test.ts src/components/conversation/ConversationView.keyModes.test.tsx src/components/shell/TopBar.keyModes.test.tsx src/components/shell/ApiKeyModal.test.tsx src/phase1.test.tsx
npm run typecheck
npm run build
```

Expected: 全部 PASS。同步把 `phase1.test.tsx` 的请求改为 `GenerateParams`，给现有 `<Composer>` 显式传 `credentialMode="system"`；所有 ConversationDetail fixture 补真实 `credentialMode/deadlineAt`，不把必填 schema 放宽为 optional。

- [ ] **Step 10: 提交原子前端启用变更**

```bash
git add src/lib/generationBatch.ts src/lib/generationBatch.test.ts src/contracts/conversation.ts src/contracts/me.ts src/hooks/useGeneration.ts src/hooks/useGenerationStatus.ts src/components/conversation/ConversationView.tsx src/components/conversation/ConversationView.keyModes.test.tsx src/components/composer/Composer.tsx src/components/shell/TopBar.tsx src/components/shell/TopBar.module.css src/components/shell/TopBar.keyModes.test.tsx src/components/shell/ApiKeyModal.tsx src/components/shell/ApiKeyModal.test.tsx src/server/reads.server.ts src/phase1.test.tsx
git commit -m "feat: enable user key modes and multi-job polling"
```

### 技术蓝图 10：后台 mode 可见性、运行时秘密哨兵与可观测脱敏

**Files:**
- Create: `tests/money/custom-key-security.test.ts`
- Create: `src/server/sentry.server.test.ts`
- Create: `tests/unit/generate-background-handler.test.ts`
- Modify: `src/server/admin/generations.server.ts:10-83`
- Modify: `app/routes/_admin.generations.tsx:135-204`
- Modify: `src/server/sentry.server.ts:1-67`
- Modify: `netlify/functions/generate-background.ts:1-16`

- [ ] **Step 1: 写 custom 与 system 两条服务端 plaintext 哨兵测试**

创建 `tests/money/custom-key-security.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listGenerations } from "../../src/server/admin/generations.server";
import { captureException, installSentryTestClient } from "../../src/server/sentry.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { runGenerationJob } from "../../src/server/generation/process";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { type TestCtx, newCtx } from "./_helpers";

const sentinel = "custom-runtime-9f4c7d2a-key";
const originalMaster = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;
const sentryException = vi.fn();
const sentryMessage = vi.fn();
let restoreSentry: (() => void) | undefined;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  sentryException.mockReset();
  sentryMessage.mockReset();
  restoreSentry = installSentryTestClient({
    captureException: sentryException,
    captureMessage: sentryMessage,
  });
  ctx = newCtx();
});
afterEach(async () => {
  restoreSentry?.();
  if (originalMaster === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalMaster;
  vi.restoreAllMocks();
  await ctx.cleanup();
});

describe("custom key runtime sentinel", () => {
  it("never reaches normal tables, status/admin responses, logs, or Sentry fallback", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const accepted = await enqueueGeneration({
      user: { id: uid, maxConcurrency: 1 },
      input: { prompt: "sentinel", size: "auto", credentialMode: "custom", customApiKey: sentinel },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await runGenerationJob(accepted.generationId, {
      callRelay: async () => {
        throw Object.assign(new Error(`401 provider echoed ${sentinel}`), { httpStatus: 401 });
      },
    });
    await captureException(new Error(`observer echoed ${sentinel}`), { generationId: accepted.generationId }, [sentinel]);

    const normalData = await ctx.sql`
      SELECT row_to_json(g)::text AS value FROM generations g WHERE g.id=${accepted.generationId}
      UNION ALL SELECT row_to_json(e)::text FROM events e WHERE e.user_id=${uid}
      UNION ALL SELECT row_to_json(i)::text FROM images i WHERE i.user_id=${uid}
      UNION ALL SELECT row_to_json(a)::text FROM audit_log a WHERE a.target_id=${accepted.generationId}`;
    expect(JSON.stringify(normalData)).not.toContain(sentinel);
    expect(JSON.stringify(await loadGenerationStatuses(uid, [accepted.generationId]))).not.toContain(sentinel);
    const [user] = await ctx.sql`SELECT email FROM users WHERE id=${uid}`;
    const admin = await listGenerations({ from: "2020-01-01", userEmail: String(user.email), pageSize: 10 });
    const adminItem = admin.items.find((item) => item.id === accepted.generationId);
    expect(adminItem).toMatchObject({ credentialMode: "custom", creditsChargedMp: 0 });
    expect(JSON.stringify(adminItem)).not.toContain(sentinel);
    expect(JSON.stringify(adminItem)).not.toContain("ciphertext");
    expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(error.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(sentryException.mock.calls)).not.toContain(sentinel);
  });
});
```

同文件再加一条 **system app_config 哨兵**：先保存测试库 `app_config.relay_api_key` 原值，在 `try/finally` 内临时写入另一随机 sentinel；mock provider 让 401 错误体回显该值，真实调用 `callRelay({ credentialMode: "system", ... })`，再把捕获到的错误交给 `captureException`。断言 relay 抛出的 message、console、`sentryException.mock.calls`、普通表和 admin/status 响应均不含 sentinel；finally 必须恢复原配置。该用例验证 app_config 优先路径，不能只测 env `RELAY_API_KEY`。

另建 `src/server/sentry.server.test.ts`，分别把 sentinel 放进 Error/message 与嵌套 context，调用 `captureException`、`captureMessage`，断言注入客户端的两个 sink 收到的序列化参数及 console 均不含 sentinel。该单元测试必须让真实 `getSentry` 路径被测试客户端替代，不能只 spy console 后宣称 Sentry 已覆盖。

Task 5 的成功 2xx raw 回显哨兵也必须保留：`callRelay` 对两种 mode 均只能返回解析后的 `images`，不能把 raw provider body 带出边界。

- [ ] **Step 2: 运行测试并确认 Sentry fallback 仍打印原始 Error**

Run: `npm run test:money -- tests/money/custom-key-security.test.ts`

Run: `npm run test:run -- src/server/sentry.server.test.ts`

Expected: FAIL；当前 `captureException` 的 console 与真实 sink 均接收原始 Error，admin item 也尚无 mode/charge 字段。若 system relay 未按 app_config 实际 Key 脱敏，第二条同样失败。

- [ ] **Step 3: 让 admin 只显示 mode 和扣费，不查询 credential 表**

`AdminGeneration` 增加：

```ts
credentialMode: "system" | "custom";
creditsChargedMp: number;
```

`listGenerations` SELECT 增加 `g.credential_mode,g.credits_charged_mp`，映射：

```ts
credentialMode: r.credential_mode as "system" | "custom",
creditsChargedMp: toInt(r.credits_charged_mp),
```

查询不得 join/select `generation_credentials`。在 `app/routes/_admin.generations.tsx` 的“尺寸”后增加表头“模式”“扣费”，行内容：

```tsx
<td className={styles.td}>
  <span className={styles.badge}>{g.credentialMode === "custom" ? "自定义" : "系统"}</span>
</td>
<td className={styles.td}>{g.creditsChargedMp === 0 ? "0" : formatCredits(g.creditsChargedMp)}</td>
```

从 `src/lib/format` 同时 import `formatCredits`。custom 失败/成功都显示 0；system 显实际 mp 转积分。

- [ ] **Step 4: 脱敏 Sentry/console 观察出口**

在 `src/server/sentry.server.ts` import `redactSecrets`，增加：

```ts
function observationSecrets(extra: string[] = []): string[] {
  return [process.env.RELAY_API_KEY ?? "", ...extra].filter(Boolean);
}

function safeObservedError(error: unknown, secrets: string[]): Error {
  const value = error as { name?: string; message?: string };
  const safe = new Error(redactSecrets(String(value?.message ?? "internal error"), secrets));
  safe.name = value?.name ?? "Error";
  return safe;
}
```

增加仅测试可安装的 Sentry client 注入点 `installSentryTestClient(client)`：只有 `process.env.NODE_ENV === "test"` 才允许调用，否则立即抛错；返回 restore 函数恢复此前 client/cache。测试 client 必须走与真实 `getSentry()` 返回值完全相同的 `captureException/captureMessage` 调用位置，不能绕开下面的脱敏逻辑。

把签名改为：

```ts
export async function captureException(
  error: unknown,
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeError = safeObservedError(error, secrets);
  const safeContext = context ? redactSecrets(context, secrets) : undefined;
  console.error("[sentry:exception]", safeError, safeContext ? JSON.stringify(safeContext) : "");
  const sentry = await getSentry();
  try {
    sentry?.captureException(safeError, safeContext ? { extra: safeContext } : undefined);
  } catch (captureError) {
    console.error("[sentry] captureException 自身失败", safeObservedError(captureError, secrets));
  }
}
```

把 `captureMessage` 同步改为：

```ts
export async function captureMessage(
  message: string,
  level: SentryLevel = "warning",
  context?: Record<string, unknown>,
  extraSecrets: string[] = [],
): Promise<void> {
  const secrets = observationSecrets(extraSecrets);
  const safeMessage = redactSecrets(message, secrets);
  const safeContext = context ? redactSecrets(context, secrets) : undefined;
  console.warn(`[sentry:${level}] ${safeMessage}`, safeContext ? JSON.stringify(safeContext) : "");
  const sentry = await getSentry();
  try {
    sentry?.captureMessage(safeMessage, { level, extra: safeContext });
  } catch (captureError) {
    console.error("[sentry] captureMessage 自身失败", safeObservedError(captureError, secrets));
  }
}
```

默认 `extraSecrets=[]`，现有调用不需要机械改签名。

`netlify/functions/generate-background.ts` catch 不打印原始异常，改为：

```ts
} catch {
  console.error("[generate-background] internal failure");
  return Response.json({ error: "internal" }, { status: 500 });
}
```

正常 provider 错误必须在 `runGenerationJob` 内先按实际 Key 脱敏并收口；到 handler 的异常只保留固定信号。

创建 `tests/unit/generate-background-handler.test.ts`（node environment），mock `runGenerationJob` 抛出带 sentinel 的 Error，调用 Background handler 后断言响应固定为 `500 { error: "internal" }`，`console.error` 只收到固定 `[generate-background] internal failure`，所有 mock calls 与响应序列化均不含 sentinel。

- [ ] **Step 5: 复核 Task 0 的静态 secrets 门禁未被运行时改造削弱**

不得在本 Task 重复或覆盖 `assert-no-secrets` 的 env 加载、主密钥扫描、`generation_credentials` 结构标记与公开 URL 精确 allowlist。构建后检查报告必须同时列出这些扫描项；如果 Task 0 未完成，本 Task 禁止开始。

- [ ] **Step 6: 跑安全哨兵、admin 和静态断言**

Run: `npm run test:money -- tests/money/custom-key-security.test.ts`

Run: `npm run test:run -- src/server/sentry.server.test.ts`

Expected: PASS；custom/system 两个 sentinel 均不出现在 normal tables、status/admin、relay error、log、Sentry fallback 或注入的 Sentry sink。

Run:

```powershell
npm run build
npm run assert-no-secrets
```

Expected: build exit 0，静态断言 PASS，扫描项包含新 env 与 credential 表名。

- [ ] **Step 7: 提交**

```bash
git add tests/money/custom-key-security.test.ts src/server/sentry.server.test.ts src/server/admin/generations.server.ts app/routes/_admin.generations.tsx src/server/sentry.server.ts netlify/functions/generate-background.ts
git commit -m "feat: expose generation modes without leaking credentials"
```

### 技术蓝图 11：隔离 E2E、可执行回滚、全量回归与生产交接

**Files:**
- Create: `tests/e2e/key-mode-fixture.ts`
- Create: `tests/e2e/key-modes.spec.ts`
- Create: `scripts/fail-custom-generations.ts`
- Create: `tests/money/fail-custom-generations.test.ts`
- Modify: `.env.example`
- Modify: `docs/PROGRESS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/dev/deploy.md`
- Modify: `docs/dev/local-acceptance.md`
- Modify: `docs/dev/10-ops-test.md`

- [ ] **Step 1: 建立只连接 disposable Neon 分支的 E2E fixture**

先确认 gitignored `.env.test` 至少包含独立 `DATABASE_URL`、`DATABASE_URL_UNPOOLED`、mutation ack、`BETTER_AUTH_URL=http://localhost:8888`、测试专用 `BETTER_AUTH_SECRET`、测试专用 `CUSTOM_KEY_JOB_ENCRYPTION_KEY` 与 `CUSTOM_KEY_MODES_ENABLED=true`。基础 E2E server 必须为 true；开关关闭用例只在单测内临时覆盖为 false，并在 `finally` 恢复 true。不得从 `.env` 继承这些值。

`tests/e2e/key-mode-fixture.ts` 第一行运行时代码调用 Task 0 的 `loadDisposableTestEnv()`；未确认、缺 URL/Auth/Key/开关、或与 `.env` 生产候选指纹相同都必须在浏览器启动前失败。fixture 提供：

- UI 注册测试用户后按 email 查询其 user id；清理时级联删除该测试用户。
- `setBalanceZero()` 同一事务把未过期 lot 的 `remaining_mp` 与 `credit_accounts.balance_mp` 归零，保持对账一致，不直接改生产共享预算键。
- stateful generate/status 桩：浏览器 `/api/generate` 被拦截时把 conversation/generation 测试行写入 disposable DB 并返回五字段 202；绝不调用真实中转，也不保存测试 custom Key。
- status 桩可按测试指定顺序把三项写成 succeeded/failed/provider_timeout；成功项同时写最小 image fixture，使刷新后的 SSR 能从 DB 恢复真实卡片。
- 每个 test 的 `finally` 清测试用户、generation/image/conversation/event fixture；不得删除全局 app_config 值。

fixture 只负责 UI 状态恢复所需的测试数据；API owner scope、加密、零扣费和 relay 分流继续由 money tests 验证，不能用浏览器路由桩冒充服务端安全测试。

- [ ] **Step 2: 拆成五条独立 Playwright 验收**

创建 `tests/e2e/key-modes.spec.ts`，不得把所有断言塞进一条长测试：

| 用例 | 必须断言 |
|---|---|
| system 零回归 | 默认当前 system；POST 明确 `credentialMode=system` 且 body 无 `customApiKey/baseUrl`；第一项 pending 时 Composer 仍锁，终态后恢复 |
| custom 零余额多任务 | fixture 把余额归零；保存 custom 后连续至少 3 项均 202；每个 body 只有同一测试 sentinel Key、无 baseUrl；三项乱序终态逐卡刷新，本站余额保持 0 |
| deadline/恢复 | 使用服务器 202 的短 deadline；过期后 UI 显示“状态确认中”但 status 请求计数继续增长；随后服务端 `provider_timeout` 文案落定；中途 reload 后 pending/终态从 DB 恢复 |
| 配置持久化与账号隔离 | 用户 A 保存 custom，refresh/重新登录仍在；退出并注册用户 B 默认 system 且看不到 A 的 Key；返回 A 后恢复 A 配置；清除后回 system |
| 可访问性/响应式 | 入口的 title/aria 含当前 mode；初始焦点、Tab 圈定、Escape、关闭后焦点恢复；360/768/1024/1440 四档无横向溢出、遮挡或截断 |

每条 custom 测试先断言 `/api/me.customKeyModesEnabled === true`。另加开关关闭测试：custom radio/save disabled、已有本地 Key 不被删除、system 仍能提交、不得静默把 custom 请求改为 system 扣分。截图文件名含 viewport 与用例名，人工检查最长中文错误文案、TopBar、Modal 和 3 张并行卡。

- [ ] **Step 3: 用测试 env 启动 Netlify 与 Playwright**

Terminal A：

```powershell
Remove-Item -Recurse -Force build, .netlify -ErrorAction SilentlyContinue
npm run dev:netlify:test
```

Terminal B：

```powershell
$env:E2E_BASE_URL='http://localhost:8888'
node --import tsx scripts/test-env-guard.ts node_modules/@playwright/test/cli.js test tests/e2e/key-modes.spec.ts
```

Expected: 五条用例及四档 viewport 全部 PASS。两个进程都经过同一 test-env guard；终端不得出现 DB URL、Key 或测试 sentinel。人工打开所有截图，确认非空、无遮挡、无横向滚动。

- [ ] **Step 4: 实现默认 dry-run 的受审计 custom 紧急收口脚本**

创建 `scripts/fail-custom-generations.ts`。参数固定为 `--admin-id <uuid> --reason <非空> [--apply --confirm FAIL_CUSTOM_GENERATIONS]`：

- `CUSTOM_KEY_MODES_ENABLED=true` 时拒绝运行，要求先关闭入口并完成一次部署。
- 默认只输出非终态 custom 数量和状态分布，不输出 request、ciphertext、Key、用户 email 或 provider body。
- dry-run 不要求 `--confirm`；只有同时传 `--apply` 与精确 confirm 才开启一个 Pool/WS 事务，缺任一项都拒绝写入。`FOR UPDATE` 锁 `credential_mode='custom' AND status IN ('queued','claimed','running')`。
- 同事务把目标行收口 `failed/unknown`，写固定运维文案、`credits_charged_mp=0`、`completed_at/updated_at`，删除对应 `generation_credentials`，逐项写 `image_failed` event 与含 admin/reason/count 的 `audit_log`。
- 竞争中已经终态的行因 UPDATE status predicate 不命中，脚本不得覆盖 success，也不得解密或 SELECT ciphertext。
- 事务后复查目标凭据为 0、custom 非终态为 0；任一断言失败以非零退出并告警。

增加 money test 覆盖 dry-run 无写入、缺参数拒绝、成功收口、成功竞态不覆盖、凭据物理删除和审计记录。

Run dry-run:

```powershell
if (-not $env:ROLLBACK_ADMIN_ID) { throw "ROLLBACK_ADMIN_ID is required" }
node --env-file=.env --import tsx scripts/fail-custom-generations.ts --admin-id $env:ROLLBACK_ADMIN_ID --reason "rollback audit"
```

Run apply（仅在开关已关闭且 dry-run 范围确认后）：

```powershell
if (-not $env:ROLLBACK_ADMIN_ID) { throw "ROLLBACK_ADMIN_ID is required" }
node --env-file=.env --import tsx scripts/fail-custom-generations.ts --admin-id $env:ROLLBACK_ADMIN_ID --reason "rollback containment" --apply --confirm FAIL_CUSTOM_GENERATIONS
```

- [ ] **Step 5: 跑完整新鲜回归，不复用历史数字**

依次执行：

```powershell
npm run typecheck
npm run test:run
npm run test:money
node --import tsx scripts/test-env-guard.ts scripts/cron-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/db-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/auth-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/reads-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/admin-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/search-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/inspirations-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/inspiration-submissions-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/deletes-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/account-reads-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/notifications-smoke.ts
node --import tsx scripts/test-env-guard.ts scripts/rename-smoke.ts
npm run build
npm run assert-no-secrets
```

若某 smoke 仍自行加载 `.env` 或会修改全局配置，先改为复用 test-env guard、保存/恢复原值；不能以“历史已通过”代替本轮输出。真实 relay/storage smoke 只在受控 staging/生产发布步骤运行，不把真实用户 Key 写在命令行。

安全复核：

```powershell
rg -n "api/generate/custom|RELAY_API_KEY.*localStorage|customApiKey.*console|customApiKey.*log" src app netlify tests scripts
rg -n "CUSTOM_KEY_REQUIRED|SYSTEM_MODE_FORBIDS_CUSTOM_KEY|CUSTOM_KEY_MODES_DISABLED|custom_key_invalid|custom_key_quota|relay_rate_limited|provider_timeout|storage_failed" src app netlify tests
rg -n "generation_credentials" app src netlify
rg -n "key=.*slice|RELAY_API_KEY.*slice" scripts/relay*.ts
```

Expected: 无第二 generate endpoint、无 system Key 本地存储、无 custom Key 日志或前缀/长度输出；credential 表只在 migration、generation-scoped credential helper、deadline/rollback 清理和安全测试出现，admin/普通读取不得 join/select。错误码并集在 contract、mapper、UI 与测试都有命中。

- [ ] **Step 6: 先暗部署，再启用生产开关并验证回滚**

`.env.example` 只增加名称与说明：

```dotenv
# 32-byte base64 key for generation-scoped custom API key AES-256-GCM encryption.
CUSTOM_KEY_JOB_ENCRYPTION_KEY=
# Operational kill switch. Missing/false keeps custom submissions disabled.
CUSTOM_KEY_MODES_ENABLED=false
```

按 `docs/dev/deploy.md` 执行：先整合当前分支与 main，备份并应用 additive migration；以全新随机主密钥和 `CUSTOM_KEY_MODES_ENABLED=false` 部署，验证 system 全链路、旧客户端缺 mode、custom 503 且零写入。随后把开关改 true 再部署，用受控测试账号和临时 provider Key 各跑 t2i/i2i custom 一次，确认本站零扣、正常落图、凭据终态即删、日志/Sentry/admin/普通表无 sentinel。

回滚演练顺序固定为：开关 false 并部署 -> 等待在途最多 5 分钟 -> dry-run 脚本 -> 必要时 apply 收口 -> 验证凭据/非终态为 0 -> 才允许回滚应用代码。凭据和 custom 非终态清零前不得删除/轮换主密钥；additive 列/表不 DROP。

- [ ] **Step 7: 只按真实阶段同步记忆与里程碑 14**

本地实现/测试完成但未部署时，只把 `docs/PROGRESS.md` 的**里程碑 14**写成“本地完成、待生产部署”，记录本轮真实 commit 和新鲜测试数字；里程碑 13 保持 UGC 已上线。只有 Step 6 全部生产 smoke 完成，才把 `CLAUDE.md`、PROGRESS、deploy runbook 改为 Key 模式已上线；否则继续明确生产 system-only。

密码轮换/会话吊销是本次文档审查发现的独立 P0 运维项，不能因 Key 功能实现完成而勾掉；Git 历史清理是否执行单独决策。

- [ ] **Step 8: 提交验证与交接记录**

```bash
git add tests/e2e/key-mode-fixture.ts tests/e2e/key-modes.spec.ts scripts/fail-custom-generations.ts tests/money/fail-custom-generations.test.ts .env.example docs/PROGRESS.md CLAUDE.md docs/dev/deploy.md docs/dev/local-acceptance.md docs/dev/10-ops-test.md
git commit -m "test: verify and operationalize user key modes"
```

## 计划自检

| PRD 范围 | 覆盖技术蓝图 |
|---|---|
| 顶栏入口、单选、显隐、保存/切换/清除、固定 URL、user-scoped 明文 | 1、8、11 |
| 统一 `/api/generate`、mode 契约、无第二端点 | 1、4、11 |
| generation-scoped 加密、原子创建、终态立即删除、10min TTL + 5min cron | 2、3、4、6、7、10 |
| system 钱/预算/并发不回归；custom 零扣费零限制 | 4、6、10、11 |
| 同一 relay 的 t2i/i2i、无自动 fallback、精确错误码 | 5、6、11 |
| 多任务提交、批量 owner-scoped 状态、刷新恢复 | 7、9、11 |
| 两种模式统一五分钟 deadline、30 秒预留、终态竞争 | 2、5、7、11 |
| 同一存储/历史/资产/保留期 | 6、9、11 |
| plaintext 不进普通 DB/log/event/audit/Sentry/响应/admin | 3、5、6、7、10、11 |
| 缺省关闭 kill switch、暗部署、受审计紧急收口与安全回滚 | 1、6、9、11 |

执行者完成计划后，只以顶部微任务账本 169 行全部 `[x]` 为进度依据；后文技术蓝图 checkbox 是代码定位参考，不承载状态。最终仍须以技术蓝图 11 的完整命令输出作为完成证据，不得用旧的 2026-06-23 测试数字代替新鲜验证。
