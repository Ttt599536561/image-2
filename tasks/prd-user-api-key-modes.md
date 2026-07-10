# 用户生图 Key 模式与多任务生成 PRD

- 状态：已完成需求对齐，待用户书面复核
- 日期：2026-07-11
- 范围：仅定义需求与验收，不包含业务代码实现
- 自定义模式固定中转地址：`https://api.tangguo.xin/v1`

## 1. 背景与源码现状

当前产品只支持全站共享的系统 Key。本需求为登录用户增加“系统 Key / 自定义 Key”单选，同时保留同一套对话、后台任务、图片存储和状态展示。

### 1.1 顶部导航

- `src/components/shell/TopBar.tsx` 挂载在对话、资产库、灵感库、充值和账号页。
- 顶栏右侧现有本次图片、积分、通知和主题入口；新增入口必须在 360px 移动端保持无溢出。
- 当前没有用户级 Key 配置入口或状态。

### 1.2 系统 Key 配置

- 管理员可配置 `relay_base_url` 与 `relay_api_key`，运行时由 `src/server/relay.ts` 读取。
- 系统配置优先级为 `app_config`，环境变量 `RELAY_BASE_URL` / `RELAY_API_KEY` 兜底。
- 系统 Key 的现有计费、余额、预算和并发行为必须保持不变。

### 1.3 生图请求链路

当前主链路为：

1. 浏览器乐观创建 conversation ID 与 generation ID。
2. 图生图场景先上传参考图。
3. 统一调用 `POST /api/generate`。
4. 服务端执行鉴权与入队校验，写 `generations(queued)`，返回 `202`。
5. Netlify Background Function 抢占任务、请求中转、结果落对象存储。
6. 系统模式成功后扣积分并写 `succeeded`。
7. 浏览器轮询 `GET /api/generate-status`，终态后刷新会话、余额和资产。

### 1.4 当前限制

- `ConversationView` 当前只追踪一个进行中任务，并在生成时锁住 Composer，无法在同一会话连续提交多项。
- 当前上游软超时约 4.5 分钟、服务端权威超时约 5 分钟；本需求统一为用户可理解的“总任务最长 5 分钟”。
- 当前错误脱敏主要围绕系统 Key；自定义 Key 进入请求后必须按本次实际 Key 脱敏。
- `src/api/imageGeneration.ts` 保留未被业务使用的浏览器直连函数；本需求不得重新启用浏览器直连。

## 2. 已确认产品决策

| 项目 | 已确认决策 |
|---|---|
| 默认模式 | 首次使用为系统 Key |
| 模式记忆 | 当前浏览器记住上次选择，按登录用户 ID 隔离 |
| 自定义 Key 存储 | 浏览器 `localStorage` 明文保存，不加密，不跨设备 |
| 自定义 URL | 固定 `https://api.tangguo.xin/v1`，不可修改 |
| 顶部入口 | `KeyRound` 图标打开模态框 |
| 模式控件 | 系统 Key / 自定义 Key 互斥单选 |
| 保存校验 | 只校验 Key 非空，不在保存时请求上游 |
| 本站生图接口 | 两种模式统一调用现有 `POST /api/generate` |
| 上游接口 | 两种模式复用同一 `callRelay`；文生图走 `/images/generations`，图生图走 `/images/edits` |
| 自定义 Key 传递 | 每次生成通过 HTTPS 放入 `/api/generate` 请求体 |
| 服务端 Key 存储 | 仅按 generation 加密暂存，终态删除，15 分钟为异常残留兜底 |
| 自定义模式计费 | 跳过余额检查，不扣积分，不写 debit 流水 |
| 自定义模式预算 | 不计入系统 Key 日预算 |
| 自定义模式限制 | 无账号并发上限、无提交限流 |
| 多任务 | 自定义模式允许前一项未完成时继续提交，多项同时生成 |
| 图片保存 | 与系统模式一致，自动落对象存储并进入会话历史和资产库 |
| 自动回退 | 自定义失败后不自动使用系统 Key |
| 最大时长 | 系统和自定义模式均从入队起最多 5 分钟 |
| 任务取消 | 不新增取消能力 |

## 3. 目标

- 用户可从所有前台页面顶部快速查看和切换 Key 模式。
- 系统与自定义模式使用同一个本站生图接口、同一个后台任务状态机和同一套图片结果链路。
- 自定义模式不消耗本站积分，不受系统 Key 预算、账号并发和提交限流约束。
- 自定义模式允许连续提交多项，页面同时显示所有进行中的任务。
- 两种模式都在 5 分钟内进入成功或失败终态，不出现永久生成中。
- 自定义 Key 除用户明确接受的浏览器明文存储和 HTTPS 请求体外，不进入普通业务字段、日志、错误、审计或前端响应。
- 系统模式现有钱链路、幂等、预算和并发行为零回归。

## 4. 总体设计

### 4.1 浏览器配置

- 顶栏新增 Key 图标，tooltip 与 `aria-label` 显示当前模式。
- 点击打开“API 配置”模态框，使用分段单选控件选择系统 Key 或自定义 Key。
- 自定义模式显示密码输入框、显示/隐藏按钮、保存和清除操作。
- 固定中转地址以只读文本显示，不提供输入框。
- 本地配置按用户 ID 命名空间保存，例如 `{ mode, apiKey }`；退出登录后保留。
- 切换为系统模式时保留本地自定义 Key；再次切回可直接使用。
- 只有“清除自定义 Key”才删除本地 Key，并自动把模式切回系统。
- 无本地记录或记录损坏时安全回退到系统模式。

### 4.2 统一请求接口

两种模式统一调用 `POST /api/generate`，不得新增 `/api/generate/custom` 之类的用户端生图接口。

请求契约在现有字段基础上增加：

```json
{
  "credentialMode": "custom",
  "customApiKey": "user-provided-key",
  "prompt": "一座雨夜城市",
  "size": "1024x1024",
  "quality": "auto",
  "background": "auto",
  "conversationId": "uuid",
  "generationId": "uuid"
}
```

- `credentialMode` 必须为 `system` 或 `custom`。
- `custom` 模式必须携带非空 `customApiKey`；不得携带 Base URL。
- `system` 模式不得携带 `customApiKey`。
- 响应继续统一为 `202 { generationId, conversationId, status: "queued" }`。

### 4.3 入队分支

统一端点完成严格登录与封禁校验后按模式进入两条内部路径：

**系统模式：**

- 完整保留现有余额闸、账号并发闸、系统日预算软闸和硬闸。
- 保持成功才扣积分、FIFO 扣批次和 `generation_id` 幂等。
- Key 继续由服务端全局配置解析。

**自定义模式：**

- 仍校验提示词、尺寸、会话归属、generation ID 和参考图归属。
- 跳过余额、系统日预算、账号并发和提交限流。
- 允许余额为 0 的用户正常入队。
- 将本次 Key 加密为 generation 级临时凭据，并与 generation 可靠地一起写入；任一步失败都不得留下半条任务。

### 4.4 任务级临时凭据

- 新增独立临时凭据记录，以 `generation_id` 唯一关联。
- 记录只包含密文、随机 IV/nonce、认证信息、加密版本和过期时间。
- 使用服务端部署密钥执行 AES-256-GCM 或托管 KMS 等价的带认证加密。
- `generations` 只记录非敏感的 `credential_mode`，不得保存 Key 明文、密文或 Authorization。
- Background Function 只有在抢占成功后才读取并解密自定义 Key。
- generation 成功或失败后立即删除临时凭据。
- 平台异常中断时，由 cron 在任务超时收口后清理；15 分钟为最终孤儿清理兜底，不是任务运行时长。

### 4.5 统一中转调用

- 两种模式必须进入同一个 `callRelay` 实现，不复制请求构造和响应解析。
- 系统模式向 `callRelay` 提供服务端系统 Key 与当前系统 Base URL。
- 自定义模式向 `callRelay` 提供任务临时 Key 与固定 Base URL `https://api.tangguo.xin/v1`。
- 两种模式继续固定 `gpt-image-2`、`n=1`、`moderation=low`、`response_format=b64_json`。
- 文生图共同使用 `/images/generations`；图生图共同使用 `/images/edits`。
- 中转原始响应中的 Key、Authorization 和敏感内容必须在离开调用边界前脱敏。

### 4.6 成功收口

**系统模式：**继续使用现有 `chargeOnSuccess` 钱事务。

**自定义模式：**使用独立的不扣费成功事务：

1. 锁定并确认 generation 仍为 `running`。
2. 以 generation ID 幂等检查结果图。
3. 写 `images` 和成功事件。
4. 标记 generation 为 `succeeded`，`credits_charged_mp=0`。
5. 不修改 `credit_lots`、`credit_accounts` 或 `credit_ledger`。

图片保留期、会话历史、资产库、下载和清理规则与系统模式一致。

### 4.7 多任务与状态轮询

- 自定义模式不因已有 pending generation 锁住 Composer。
- 每次提交仍保留同步防双击，避免一次点击意外发送两份；上一项入队完成后即可继续提交。
- 同一会话可同时存在多个 `queued`、`claimed` 或 `running` generation。
- 扩展现有 `/api/generate-status`，在保留单 ID 兼容的同时支持批量查询多个 ID。
- 批量状态查询必须 owner-scoped；单次传输数量保护不构成生成任务限制，前端可自动分批。
- 当前会话只发批量状态请求，不为每个 generation 各起一套轮询。
- 任一任务终态后就地更新对应结果，不影响其他任务继续生成。

### 4.8 五分钟统一超时

- system 与 custom 在 generation 入队时都写明确的 `deadline_at = created_at + 5 minutes` 或等价权威截止时间。
- 上游请求在 `deadline_at - 30 seconds` 中止，为响应解析、对象存储和终态事务预留时间。
- 到 5 分钟仍未成功的 `queued`、`claimed`、`running` 任务统一置为 `failed/provider_timeout`。
- 状态查询在读取前可原子收口已过截止时间的 owner-scoped 任务，避免等待下一次分钟级 cron。
- cron 继续作为无人轮询、后台中断和孤儿任务的权威兜底。
- 前端每 2 秒批量轮询；到截止时间做最后一次刷新并显示超时，不再保留“生成中”。
- 用户文案统一为“请求超时，本次未扣积分，请重试”。

## 5. 用户故事

### US-001：在顶部切换 Key 模式

**描述：** 作为登录用户，我希望从顶部导航选择系统 Key 或自定义 Key，以便控制下一项生成使用的凭据。

**验收标准：**

- [ ] 所有受保护前台页面均显示 Key 图标，后台管理页面不显示。
- [ ] 点击打开模态框，系统/自定义为互斥单选。
- [ ] 首次默认系统模式；保存后无需刷新即生效。
- [ ] 模式与 Key 按用户 ID 保存在当前浏览器，刷新和重新登录后仍在。
- [ ] 切回系统模式不删除 Key；清除 Key 后自动切回系统。
- [ ] 自定义 URL 只读且固定为 `https://api.tangguo.xin/v1`。
- [ ] 360px、768px、1024px 和 1440px 下无重叠或溢出。
- [ ] 键盘、焦点圈定、Esc 关闭和关闭后焦点恢复符合 dialog 可访问性要求。
- [ ] 浏览器自动化验证桌面与移动端。

### US-002：通过统一接口提交两种模式

**描述：** 作为用户，我希望无论选择哪种 Key，都使用相同生图接口和结果链路，以免两套行为不一致。

**验收标准：**

- [ ] 两种模式都只调用 `POST /api/generate`。
- [ ] 系统请求不携带自定义 Key，自定义请求携带模式与 Key，不携带 URL。
- [ ] 两种模式返回相同 202 响应结构。
- [ ] 两种模式都进入同一 generation 状态机与同一 `callRelay`。
- [ ] 文生图和图生图在两种模式下均可成功。
- [ ] 自定义失败不会自动切换或重发为系统模式。

### US-003：自定义模式零扣费、零使用限制

**描述：** 作为已在其他站点购买自定义 Key 的用户，我希望使用该 Key 时不再消耗本站积分，也不受本站系统 Key 限制。

**验收标准：**

- [ ] 余额为 0 时自定义模式仍可提交。
- [ ] 自定义模式不执行余额闸、系统预算闸、账号并发闸或提交限流。
- [ ] Composer 不显示“积分不足，去充值”，改为明确显示自定义模式不扣积分。
- [ ] 自定义成功后 `creditsChargedMp=0`，账户余额不变且无 debit 流水。
- [ ] 自定义失败后余额不变。
- [ ] 系统模式的全部余额、预算、并发与扣费行为保持原样。

### US-004：连续提交多个自定义任务

**描述：** 作为自定义 Key 用户，我希望上一张仍在生成时继续提交下一张，以便并行处理多个任务。

**验收标准：**

- [ ] 第一项入队后 Composer 立即恢复可输入状态，不等待图片完成。
- [ ] 用户可连续提交至少三项，三项均独立入队并显示生成状态。
- [ ] 同一次点击、Enter 长按或重复事件不会产生两条相同任务。
- [ ] 页面批量轮询所有进行中任务，一次状态请求可覆盖多项。
- [ ] 多项可以任意顺序成功或失败，并准确替换各自占位。
- [ ] 刷新或切换会话不终止后台任务，重新进入后可恢复状态。

### US-005：两种模式统一五分钟超时

**描述：** 作为用户，我希望任何生图请求最多等待 5 分钟，超时后得到明确结果。

**验收标准：**

- [ ] 系统与自定义任务均从 generation 创建时间计算同一 5 分钟截止时间。
- [ ] 在 `deadline_at - 30 seconds` 中止仍未返回的上游请求。
- [ ] 到 5 分钟仍未成功的任务进入 `failed/provider_timeout`。
- [ ] 超时释放系统任务并发占用；自定义任务也离开进行中集合。
- [ ] 超时不扣积分，错误卡显示“请求超时，本次未扣积分，请重试”。
- [ ] 临时自定义 Key 在超时终态后删除。
- [ ] 使用虚拟时钟或可注入时钟验证，不在 CI 中真实等待 5 分钟。

### US-006：获得可操作且不泄密的错误

**描述：** 作为用户，我希望失败时看到明确中文原因，同时自定义 Key 不进入错误或日志。

**验收标准：**

- [ ] 自定义 Key 为空时前端阻止提交并打开配置模态框；服务端也拒绝空 Key。
- [ ] 自定义 Key 401 或鉴权型 403 显示“自定义 Key 无效，请检查后重试”。
- [ ] 配额、限流、网络、超时、参数、内容拒绝、响应异常和存储失败分别映射稳定错误码。
- [ ] 错误卡保留提示词，可修改 Key 后手动重试。
- [ ] 不自动清除本地 Key，不自动切系统模式。
- [ ] 用户端与后台只显示脱敏摘要，不显示 Key、Authorization 或中转完整错误体。
- [ ] 所有失败路径均验证不误扣积分。

## 6. 功能需求

### 6.1 顶栏与本地配置

- **FR-1：** `TopBar` 必须新增 `KeyRound` 图标入口，并显示当前模式的 tooltip 与 `aria-label`。
- **FR-2：** 模态框必须使用互斥单选控件，不能使用可同时开启的 checkbox。
- **FR-3：** 自定义 Key 使用密码输入框，并提供显示/隐藏按钮。
- **FR-4：** 固定地址只读显示为 `https://api.tangguo.xin/v1`，不得编辑或随系统配置变化。
- **FR-5：** 本地记录必须按当前用户 ID 隔离，包含 `mode` 与 `apiKey`，不包含 URL。
- **FR-6：** 本地 Key 按用户确认以明文保存；文档与 UI 不得宣称它能够抵御 XSS 或共享设备读取。
- **FR-7：** 本地记录缺失、解析失败或 mode 非法时回退系统模式。
- **FR-8：** 切换系统模式保留 Key；清除操作删除 Key 并切回系统。
- **FR-9：** 保存自定义模式只做非空与合理长度校验，不发测试请求。
- **FR-10：** 自定义模式不受余额影响，Composer 必须允许余额为 0 时提交。

### 6.2 统一生成契约

- **FR-11：** 用户端只存在一个生图入口 `POST /api/generate`。
- **FR-12：** `GenerateRequest` 新增必填 `credentialMode: system|custom`。
- **FR-13：** custom 模式要求 `customApiKey` 非空且限制最大长度，system 模式携带该字段必须拒绝或在解析边界立即丢弃且绝不记录。
- **FR-14：** 客户端不得发送自定义 Base URL；服务端 custom 模式只使用固定常量。
- **FR-15：** 两种模式成功入队都返回相同 202 契约。
- **FR-16：** generation 必须记录 `credential_mode`，存量行与未传模式的兼容迁移默认 `system`。

### 6.3 入队与任务凭据

- **FR-17：** 两种模式首先执行严格登录、封禁、参数、会话归属和参考图归属校验。
- **FR-18：** system 模式完整复用现有余额、并发和系统预算校验。
- **FR-19：** custom 模式显式跳过余额、并发、系统预算和提交限流，不得因账户余额不足拒绝。
- **FR-20：** custom Key 必须在生成端点内加密后才可持久化，不得先写明文中间字段。
- **FR-21：** generation 与临时凭据必须原子或以等价补偿机制一起创建；无凭据的 custom 任务不得返回 202。
- **FR-22：** Background Function 触发载荷继续只含 `generationId`。
- **FR-23：** 临时凭据必须 generation-scoped，不得复用为用户级服务端配置。
- **FR-24：** 临时凭据在任务终态后立即删除，异常孤儿最迟 15 分钟清理。

### 6.4 中转与成功事务

- **FR-25：** 两种模式共用 `callRelay` 的请求构造、超时、解析和脱敏实现。
- **FR-26：** system 模式解析现有全局 URL/Key；custom 模式使用临时 Key 和固定 URL。
- **FR-27：** 两种模式共同固定模型、图片数量、审核与 base64 返回格式。
- **FR-28：** custom 模式失败不得自动调用 system Key。
- **FR-29：** system 成功继续走现有扣费事务。
- **FR-30：** custom 成功必须走幂等的不扣费事务，写图片、成功事件和 `credits_charged_mp=0`，不写任何积分变动。
- **FR-31：** custom 图片的保留、历史、资产库和清理规则与 system 一致。

### 6.5 多任务状态

- **FR-32：** custom 模式不得因同一会话已有进行中任务而禁用 Composer。
- **FR-33：** 提交控制只防止同一次用户动作重复，不得锁到图片终态。
- **FR-34：** 状态接口必须兼容单 ID，并新增 owner-scoped 批量查询。
- **FR-35：** 前端必须批量追踪当前会话全部非终态 generation，并按 ID 更新对应卡片。
- **FR-36：** 单个任务终态不得停止其他任务的轮询。
- **FR-37：** 刷新、路由切换或页面关闭不得取消服务端任务。

### 6.6 五分钟超时

- **FR-38：** system 与 custom 使用同一权威 5 分钟 deadline，起点为 generation 创建成功。
- **FR-39：** 上游请求必须使用剩余 deadline，并在截止前固定预留 30 秒供落图与终态事务。
- **FR-40：** 状态读取和 cron 都必须能幂等地把过期中间态改为 `failed/provider_timeout`。
- **FR-41：** 终态竞争必须以状态谓词或行锁保证成功与超时只能一个生效。
- **FR-42：** 前端到 deadline 后最后刷新一次并停止显示生成动画。
- **FR-43：** 超时任务不扣积分并释放 system 并发占用。

### 6.7 错误与脱敏

- **FR-44：** 入队错误新增 `CUSTOM_KEY_REQUIRED`，空 Key 不创建任务。
- **FR-45：** 任务错误至少覆盖 `custom_key_invalid`、`custom_key_quota`、`relay_rate_limited`、`provider_timeout`、`relay_unreachable`、`invalid_request`、`content_rejected`、`invalid_response`、`storage_failed`、`unknown`。
- **FR-46：** 401 与明确鉴权型 403 映射 `custom_key_invalid`；内容策略 403 映射 `content_rejected`。
- **FR-47：** 配额错误映射 `custom_key_quota`，普通 429 映射 `relay_rate_limited`。
- **FR-48：** 脱敏函数必须接收本次实际使用的 system 或 custom Key，覆盖精确值、Bearer 头和常见 Key 形态。
- **FR-49：** Key 不得进入 generation.error、events、audit_log、Sentry、应用日志、管理端响应或用户端响应。
- **FR-50：** 生成失败必须保留提示词并允许手动重试，不得自动切模式或清除本地 Key。

## 7. 错误与用户文案

| 场景 | 错误码 | 用户文案 | 是否入队 | 是否扣积分 |
|---|---|---|---|---|
| custom 模式未提供 Key | `CUSTOM_KEY_REQUIRED` | 请先填写并保存自定义 Key | 否 | 否 |
| 自定义 Key 鉴权失败 | `custom_key_invalid` | 自定义 Key 无效，请检查后重试 | 是 | 否 |
| 自定义 Key 配额不足 | `custom_key_quota` | 自定义 Key 额度不足，请检查服务商账户 | 是 | 否 |
| 上游限流 | `relay_rate_limited` | 生成服务请求过多，请稍后重试 | 是 | 否 |
| 网络、DNS 或 TLS 失败 | `relay_unreachable` | 暂时连不上生成服务，请稍后重试 | 是 | 否 |
| 总任务达到 5 分钟 | `provider_timeout` | 请求超时，本次未扣积分，请重试 | 是 | 否 |
| 参数不支持 | `invalid_request` | 生成参数有误，请调整后重试 | 是 | 否 |
| 内容策略拒绝 | `content_rejected` | 提示词未通过内容审核，请调整后重试 | 是 | 否 |
| 2xx 但 JSON 或图片字段无效 | `invalid_response` | 生成服务返回异常，请稍后重试 | 是 | 否 |
| 图片落对象存储失败 | `storage_failed` | 图片保存失败，本次未扣积分，请重试 | 是 | 否 |
| 未分类异常 | `unknown` | 生成失败，本次未扣积分，请重试 | 是 | 否 |

system 模式原有 `INSUFFICIENT_CREDITS`、`CONCURRENCY_LIMIT`、`BUDGET_EXHAUSTED` 等入队错误保持不变。

## 8. 明确接受的风险

### 8.1 浏览器明文 Key

- 自定义 Key 明文存在当前用户浏览器 `localStorage`。
- 同源 XSS、恶意扩展、共享操作系统账户或可读取浏览器配置的人可能取得 Key。
- “用户基本只有自己使用”是接受该风险的业务前提。
- 产品不得把此方案描述为端到端加密或安全保险箱。

### 8.2 无并发与限流

- custom 模式可同时创建任意数量的后台任务。
- 即使用户承担中转 Key 费用，本站仍承担 Netlify 计算、数据库轮询、对象存储和流量成本。
- 需求明确不增加账号并发、提交限流或系统预算约束，该平台成本风险已接受。
- 防双击属于交互正确性，不属于并发或使用限额。

## 9. 非目标

- 不新增 `/api/generate/custom` 或另一套用户端生图接口。
- 不在服务端长期保存用户级自定义 Key。
- 不加密浏览器 localStorage 中的自定义 Key。
- 不支持自定义 Base URL、多个自定义 Key、模型选择、Provider OAuth 或跨设备同步。
- 不允许浏览器直接请求中转站。
- 不为 custom 模式扣积分、检查余额、检查系统预算、限制并发或限流。
- 不在 custom 失败后自动回退 system。
- 不改变 system 模式现有计费、预算、并发或积分规则。
- 不新增任务取消、SSE、WebSocket 或独立队列服务。

## 10. 测试与验收总表

### 10.1 系统模式回归

- [ ] 系统请求仍只使用服务端 Key，不携带 custom Key。
- [ ] 余额不足、并发满、预算耗尽仍分别按现有错误拒绝。
- [ ] 系统成功只扣一次，失败不扣，账本和余额一致。
- [ ] 平台重试、cron 重派和双实例抢占不会重复调用或扣费。
- [ ] 文生图、图生图、图片落库、会话历史和资产库回归通过。

### 10.2 自定义模式

- [ ] 余额为 0、系统预算已满、系统并发已满时 custom 仍可入队。
- [ ] 连续提交至少三项均成功入队，不等待前项终态。
- [ ] 三项状态通过批量接口 owner-scoped 返回并准确更新各自卡片。
- [ ] custom 成功图片落库，`creditsChargedMp=0`，无 debit 流水，余额不变。
- [ ] custom 失败无积分变动且不自动调用 system Key。
- [ ] custom 文生图和图生图都请求固定中转地址与正确 endpoint。

### 10.3 临时 Key 安全

- [ ] `/api/generate` 接收到测试哨兵 Key 后，临时凭据表只出现密文，不出现明文。
- [ ] Background Function 可解密并使用该 generation 的 Key，不能读取其他 generation 的凭据。
- [ ] 成功、失败和超时终态均删除临时凭据；异常残留在 15 分钟后清除。
- [ ] generation、图片、事件、账本、审计、Sentry、应用日志和 API 响应均不含哨兵 Key。
- [ ] 上游把 Key 回显在错误体时，持久化和展示结果仍为脱敏值。
- [ ] 本地 localStorage 与 HTTPS `/api/generate` 请求体包含明文 Key 属于已确认设计，不应被测试误判为缺陷。

### 10.4 五分钟超时

- [ ] system 和 custom 均使用同一 5 分钟 deadline。
- [ ] 上游延迟未越过安全截止时可成功落图。
- [ ] 到 5 分钟仍未成功的 queued、claimed、running 任务均转为 `failed/provider_timeout`。
- [ ] 状态轮询能在 5 分钟截止时主动收口，不依赖下一次分钟 cron 才更新 UI。
- [ ] 成功事务与超时收口并发时恰有一个终态生效。
- [ ] 超时 custom 临时 Key 被删除，system 与 custom 均不扣积分。
- [ ] 全部时间测试使用虚拟时钟或依赖注入，不真实等待 5 分钟。

### 10.5 前端体验

- [ ] 顶栏入口、模式单选、密码显示/隐藏、保存、切换和清除均可操作。
- [ ] 刷新与重新登录后按当前用户恢复上次模式和 Key。
- [ ] 多账号共用一个浏览器时配置按用户 ID 隔离。
- [ ] custom 模式余额为 0 时仍显示可用生成按钮和“不扣积分”状态。
- [ ] 多任务卡片不会互相覆盖、错图或错报错误。
- [ ] 360px 移动端及桌面截图无重叠、溢出或不可点击控件。
- [ ] 键盘与读屏语义通过模态框可访问性检查。

### 10.6 工程门禁

- [ ] `npm run typecheck` 通过。
- [ ] `npm run test:run` 通过。
- [ ] `npm run test:money` 通过，且新增 system/custom 分支真库测试。
- [ ] `npm run build` 通过。
- [ ] `npm run assert-no-secrets` 通过；运行时哨兵测试单独覆盖 custom Key。
- [ ] Playwright 覆盖模式切换、custom 零余额、多任务和五分钟超时桩。

## 11. 成功指标

- system 模式现有钱链路回归通过率 100%。
- custom 成功任务积分误扣次数为 0。
- custom 任务因系统余额、预算、并发或限流被拒次数为 0。
- 同一次用户动作产生重复 generation 的次数为 0。
- system 与 custom 超过 5 分钟仍停留中间态的任务数为 0。
- 临时 Key 明文进入普通持久化字段、日志、错误、审计或响应的次数为 0。

## 12. 预计实现影响面

- 顶栏与模态框：`src/components/shell/TopBar.tsx`、`TopBar.module.css`、新增客户端配置组件与本地存储 helper。
- 生成表单与多任务：`ConversationView.tsx`、`Composer.tsx`、`useGeneration.ts`、`useGenerationStatus.ts`。
- 统一契约：`src/contracts/generate.ts`、`netlify/functions/generate.ts`。
- 数据与迁移：`src/db/schema.ts`、新增 generation mode/deadline 与临时凭据迁移。
- 入队与成功事务：`src/server/generation/enqueue.ts`、新增 custom 内部分支与不扣费成功事务。
- 中转与脱敏：`src/server/relay.ts`、`generation/failure.ts`、`src/lib/redaction.ts`。
- 状态与超时：`generate-status.ts`、`generation/scan.server.ts`、cron 清理。
- 测试：前端组件测试、`tests/money`、运行时密钥哨兵测试和 Playwright。

## 13. 开放问题

无。浏览器明文保存、固定自定义 URL、统一 `/api/generate`、任务级加密暂存、自定义零扣费零限制、多任务并发、相同图片存储、禁止自动回退以及 system/custom 统一五分钟超时均已由用户确认。
