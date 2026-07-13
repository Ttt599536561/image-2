# AI 图像工坊 · 产品需求规格（v2 重构）

> 状态：本文 §1-§25 的 `0.2.0` 基线已于 2026-07-13 部署到腾讯云生产环境；§26 对话结果图编辑已在 `codex/admin-system-updater` 实现并完成本地验证，但尚未部署。证据见 [PROGRESS.md](PROGRESS.md)。本文件是当前 v2 的**完整产品规格**，后续只在出现新增需求时继续修订。
> 关联：[requirements.md](requirements.md)（v1 现状）、[development.md](development.md)（现有架构）、[test-cases.md](test-cases.md)（v1 用例）。
> 更新：2026-07-14。产品规则以本文件及批准设计为准；实施、部署与 Release 状态只看 [PROGRESS.md](PROGRESS.md)。

## 1. 背景与目标

- v1 是双栏表单工具、用户自带密钥。v2 已重构为**面向公众、需注册登录**的对话式生图站；2026-07-11 起目标形态同时支持 system 与 custom 两种凭据模式。
- system 的 URL/Key 由站长配置在**服务端**并按积分计费；custom 的 URL 固定 `https://api.tangguo.xin/v1`，用户 Key 明文保存在其浏览器并在该模式下随 HTTPS 生成请求提交，本站不扣积分。
- **商业化**：积分按张扣费 + **兑换码充值**（用户去第三方店铺购码 → 回站内输码下发积分），**不做真实支付页/订阅**。
- 原则：对话式为唯一主范式（不另起工作台）；能力分期；不摆空入口；**钱/余额/兑换码这类强一致数据必须进数据库、不进 KV**。

### 概念约定

- **用户/账号**：注册登录的个人；其会话、图片、积分都归属该账号。
- **会话（对话）**：一次"新建生成"开启、可续聊的线程（ChatGPT 式）。
- **一轮生成**：会话内一次"提示词 → 出图"。
- **对话区 / 对话流**：中间 UI 区 / 其内的"提示词+结果"序列。
- **本次对话图片面板**：右侧、仅汇总*当前会话*成功图（≠ 资产库）。
- **资产库**：当前用户跨会话的全部图片。
- **积分**：站内虚拟货币，`1 积分 = ¥1`。

## 2. 范围

### 2.1 本期 In Scope
- 注册登录 + 数据库；登录后才能用。
- system URL+Key 仅服务端配置；顶部导航新增 system/custom Key 单选配置（§25）。
- Composer 对话式主界面 + 五态。
- **积分计费**（按张扣费、成功才扣、余额展示）。
- **兑换码充值** + **充值页**（档位卡片跳第三方店铺）+ **兑换码入口**。
- **后台管理系统**（生成/管理兑换码、管理用户与积分、调并发）。
- 历史回看（「最近」会话列表）+ 本次对话图片面板。
- 资产库（日期分组、批量多选、删除/下载）。
- 灵感库（提示词库、搜索、标签、一键带回 Composer）；**用户投稿自己作品 → 站长审核通过后公开**（§13.1，新需求 2026-06-23）。
- **模式化并发**：system 每用户默认 2、后台可调；custom 不设账户并发或提交限流，允许多任务连续提交。
- 深色模式 + 暖色点缀。

### 2.2 已追加 / Out of Scope
- 图生图（参考图）已实现：单张 PNG/JPEG/WEBP、魔数校验、≤4MB、owner-scoped 临时上传，worker 调 `/images/edits` 并强制 `b64_json`；参考图不进资产保留期，由孤儿清理回收。当前状态见 [PROGRESS.md](PROGRESS.md)。
- 优化提示词：不实现，**按钮占位**。
- 一次多图（`n`>1）：不做，每次一张。
- 真实支付页 / 订阅：不做（走兑换码）。
- 邮箱验证码：不做（注册即用）；找回密码后置。
- 单图编辑（局部重绘/扩图）、资产库高级管理：后续。

## 3. 信息架构 / 导航

- **登录门槛**：未登录 → 跳注册/登录页，不能生图；**不做单独落地页**，入口即登录页。
- **左侧侧栏**（可折叠为图标栏）：新建生成、搜索、最近（会话）、资产库、灵感库；底部账号区（标识 + 退出）。
- **右上角**：**当前积分余额**（点击进充值页）、Key 图标、深色模式切换。对话区头部有“本次图片”开关。
- **Key 配置弹窗**：system/custom 单选；custom 提供密码输入、显隐、保存/清除和只读固定 URL。不得让用户编辑 Base URL。
- **后台管理**：独立后台路径（仅管理员），见 §9。

## 4. 账号（注册登录）

- 必须登录才能用；独立注册/登录页。
- 凭据：**邮箱 + 密码**；不做邮箱验证；找回密码后置。
- 密码用 `bcryptjs`（纯 JS、无 native 依赖）加盐哈希存储。
- 会话维持用 session/JWT。
- 账号仅用于身份/历史/积分隔离，无资料页、社交登录。

## 5. 主界面与状态机

共用"左侧对话区 + 底部 Composer"骨架。对应状态：

| 状态 | 条件 | 表现 |
|---|---|---|
| 欢迎/空 | 新会话 | Hero + Composer + 灵感画廊 |
| 生成中 | 任务进行中 | 提示词回显 + **按比例的骨架占位格** + 已用时(`MM:SS`)；**一旦开始不可取消** |
| 成功 | 出图 | 骨架替换为成品图 + 该轮操作 |
| 失败 | 报错/超时 | 错误卡 + 可读报错 + 重试，并注明**未扣/已退积分** |

> 生成中用**骨架占位格**（贴近最终比例）原地替换，不要纯转圈 spinner（异步轮询下体感差）。
> 同一会话允许同时存在多张生成中/成功/失败卡。custom 模式提交一项后 Composer 立即恢复可用，不等待上一项终态；前端批量追踪当前会话全部非终态任务。

### 5.1 Composer 构成
默认一排药丸 + 发送键：
- **参考图（+）**：上传单张 PNG/JPEG/WEBP，显示预览与移除；提交后进入图生图。
- **模型**：**全站固定 `gpt-image-2`**，不提供模型选择（Composer 不再有模型药丸；如需可在某处只读展示"当前模型 gpt-image-2"）。因此看板不做"模型占比"。
- **比例（尺寸唯一入口）**：点击弹浮层，复用现有 6 个场景选项：`智能 auto / 1:1 1024×1024 / 2:3 1024×1536 / 3:2 1536×1024 / 9:16 1088×1920 / 16:9 1920×1088`。
- **高级设置**：浮层，含**质量、背景**两项。**审核（moderation）全站固定「宽松」(low)**，不作为可选项。
- **优化提示词**：占位"敬请期待"。
- **发送**：黑色圆形。
- **数量固定 1**。
- **生成前**按模式显示：system 为“本次消耗 0.07 积分 / 剩余 Y 积分”；custom 为“不扣积分”。每次仍只生成 1 张。

### 5.2 成功态（操作挂在每一轮结果上）
单张成品图 + "已完成"标记。每轮结果旁的按钮只作用于该轮：**下载 / 重新生成（回填提示词+参数到输入框，可改再发）/ 复制提示词 / 查看原始响应(脱敏) / 存入资产库**。图生图从 Composer 的参考图入口上传，本期不增加结果图上的“用作参考”快捷动作。

### 5.3 失败
报错沿用现有映射（404/502 upstream/502 无法连达/504/CORS），**脱敏**防站长 Key 泄露；失败格明确"未扣/已退积分"。**生成中不可取消**——任务一旦开始就跑到成功或失败/超时为止（无取消按钮、无"已取消"态）。

## 6. 积分与计费

> 本节扣费规则适用于 **system 模式**。custom 模式不检查余额、不扣积分、不写 debit、不计系统 Key 日预算，成功记录 `credits_charged_mp=0`；图片存储、历史和保留期仍与 system 一致。

- **计价**：`1 积分 = ¥1`；**每张固定扣 0.07 积分**（成本~0.04、毛利~0.03）。本期所有分辨率/模型同价；**预留"按模型/分辨率差异化定价表"**（将来加贵模型或视频会失真）。
- **新用户赠送**：注册即发 **0.14 积分（= 2 张）**，一次性、用完不再送；以**账本 grant 流水**发放（带幂等 key 防重复发）。赠送积分**有效期 30 天**（全局参数、后台可改）。
- **积分有效期（每个套餐各自配置，可设「永久有效」）**：用户兑换某套餐后，这批积分在 `兑换时间 + 套餐有效期(天)` **过期作废**；套餐有效期也可设为**永久**（该批积分永不过期）。
  - **按"批次/lot"管理**：每次发放（注册赠送、兑换充值）= 一个积分批次（金额 + 过期时间）。
  - **消费按「最早过期先扣」(FIFO by expiry)**；到期未用的批次由 cron 清零并写 `expire` 流水。
  - **余额 = 未过期、未消费的批次之和**；前台可提示「X 积分将于 MM-DD 过期」。
- **入队前判断余额**：提交时校验余额 ≥ 0.07，**不足直接报错"积分不足，去充值"、不入队列**（就这一步把没钱的拦在队列外）。
- **扣费时机**：**成功才扣**（失败/超时不扣）；成功时在**事务 + 行锁**内按 FIFO 从批次扣 0.07，并发安全（行锁串行化、`remaining` 不出负；极端并发下最多某次按余额扣到 0、零头站长承担，可忽略）。
- **余额展示**：顶部常驻积分余额；生成前显示本次消耗与剩余。
- **数据模型**：**积分批次表 `credit_lots`（带 remaining + expires_at，支撑 FIFO 与过期）** + **只追加流水账本 `ledger`（审计）** + 物化余额(缓存)；余额 = 未过期批次 remaining 之和；金额**定死用毫积分整数 BIGINT**(1 积分=1000、0.07=70)，不用 float/NUMERIC（详见 §16）。

### 6.1 图片保留期（与免费/付费挂钩）

- **免费用户**：生成图默认保存 **7 天**。
- **付费用户**（**曾兑换过任意兑换码**的账号）：保存 **60 天**。
- **升级即顺延**：免费用户首次兑换成为付费后，其**已有旧图保留期统一顺延到 60 天**。
- 到期由 scheduler cron **自动清理**：删对象存储文件 + 删/标记数据库记录。
- **过期前提醒**：缩略图角标显示倒计时（如"3 天后过期"）+ 醒目"下载保留"入口；过期前站内提醒一次。

## 7. 兑换码与充值页

### 7.1 充值页
- 顶部：**当前积分余额**。
- **兑换码入口**：输入码 → 校验 → 下发积分（见 §7.3）。
- **充值档卡片**（暂定 2 档，数值可调）：
  - **¥9.9 → 10 积分**（≈ 142 张）
  - **¥29.9 → 32 积分**（≈ 457 张）
  - （备选：严格 1:1，即 9.9 / 29.9 积分。大档多送为促升级。）
- 每档"购买"按钮 → **跳转第三方商品店铺**（URL 是**套餐字段、站长后台配置**，§9）。
- 参考竞品的订阅页排版，但我们是**一次性充值**不是订阅，文案/结构据此改。

### 7.2 兑换码规则
- **站长后台预先批量生成**、每码绑定固定积分数、存数据库（见 §9）。
- **唯一**、**一次性使用**（兑换完成即作废、不可再用）、**永久有效（无过期）**。
- **一个用户可先后兑换多个不同的码**（支持复购）。
- 码用 16–20 位随机 base32、排除易混字符(0/O/1/I/l)。

### 7.3 兑换流程（后端）
- **原子核销**：`UPDATE redeem_codes SET status='redeemed',redeemed_by,redeemed_at WHERE code=$ AND status='active' RETURNING credits_value`；仅当影响行数=1，**同一事务**内写充值流水 + 加余额（以 code 为幂等 key）。这条单语句即防"一码多花/并发双击"。
- **防刷**：兑换接口按 IP/账号限流，防暴力枚举刷码。

## 8. 购买到账流程（端到端）

1. 用户在充值页点某档"购买" → 跳转第三方商品店铺。
2. 在店铺完成支付 → 获得一个兑换码（站长后台预先生成、已导入店铺）。
3. 回站内充值页"兑换码入口"输入码 → 后端原子核销（§7.3）→ 积分到账。
4. 顶部余额即时更新；任何"积分不足"处的"去充值"入口都通向此流程。

> 我们不接触支付本身（在第三方店铺完成），站内只负责"码 → 积分"的下发与对账。

## 9. 后台管理系统（新增，仅管理员）

独立后台、与普通用户角色/鉴权隔离。本期功能：

- **兑换码管理**：批量生成（指定面额/数量/批次 `batch_id`）、**生成后可一键复制（复制全部 / 批次复制码）、不强制下 CSV**、导出 CSV（保留供店铺批量导入）、查询单码状态、作废批次、对账（某批发出/已用/未用/金额）。
- **用户管理**：搜索；用户详情（余额 + 流水 + 会话/图片数 + 并发 + 注册/活跃时间）；每行操作（**封禁/解封、改密、增减积分（走 `adjust` 流水、必填原因）、增减并发、看详情**）收进行尾的**「⋯」下拉菜单**，不平铺成一排链接。
- **灵感库管理（CRUD）**：新增/编辑/删除灵感卡（封面图、标题、品类标签、提示词、摘要、排序、是否上架）。
- **灵感投稿审核（新需求 2026-06-23，§13.1）**：独立后台页「灵感投稿」——展示用户投稿队列（图 + 提交人 + 标题/提示词/分类/简介 + 状态），可按状态筛（待审 / 已通过 / 已驳回）。每条**通过**（可先改字段 → 在 `inspirations` 建上架卡 + 署名投稿人）或**驳回**（填原因）；二次确认 + 操作审计（`approve_inspiration_submission` / `reject_inspiration_submission`）+ 给投稿人发站内通知。一经审核即终态。导航项带**待审数红点**。
- **图片生成记录（列表形式）**：以**列表/表格**展示**所有用户的生成记录**（小缩略图 + 所属用户 + 生图时长 + 提示词 + 状态 + 时间），可按用户/时间筛选、分页，一屏看多条不用一直下滑；**点缩略图即放大**（无需单独"放大"按钮）。**失败行直接显示报错原因 + 状态码**（如「504 中转网关超时」），无需再点"查看错误"。**纯记录/排查用，不做"收录灵感库"等操作。**
- **套餐管理（CRUD）**：以列表展示充值套餐，可**新建/编辑/删除**。每个套餐字段：**套餐标题、套餐描述（适用场景/人群，可空，多行输入、前台 2 行内展示）、价格、积分、有效期（= 该套餐积分兑换后多少天过期，**可设「永久」**）、跳转 URL、排序、是否上架**。
- **全局参数（后台可改、不写死）**：单张扣费价（0.07）、新用户赠送额（0.14）、**新用户赠送有效期（天，默认 30）**、保留期天数（免费 7 / 付费 60）。
- **数据看板（本期最小 7 卡）**：①今日注册数 ②今日成功/失败次数 + **失败原因 Top**（system 保留七值语义，custom 用 §25 十值，读取/聚合取并集并支持按 mode 下钻）③累计总图数 ④今日/累计收入 ⑤积分发放 vs 消耗 + 账面负债 ⑥队列健康 ⑦平均生图时长。再加：付费转化率/ARPU、DAU、尺寸占比。
- **操作审计日志（本期做）**：管理员敏感操作（调积分、改密、封禁、生成/作废码、改配置/定价/文案/Key）留痕（管理员 ID、时间、对象、动作、变更前后值、IP、原因）；**只追加、管理员不可删改自己的记录**。
- **站内通知配置 / 管理（已实现）**：支持 `image_expiring`、后台 `announcement` 与灵感审核 `inspiration_reviewed`，前台铃铛统一展示。
  - ① **广播公告（✅ 已实现）**：通知类型 `announcement`（payload `{title, body, link?}`），后台撰写 → 选目标（全体 / 仅付费 `has_paid=true`）→ 下发；前台铃铛按类型渲染（Megaphone + 摘要，link 站内 navigate / 外链 window.open）。实现：`api.admin.notifications`(`requireAdmin`) + `notifications.server.broadcastAnnouncement`（per-user 批量插 `notifications`，`dedupe_key=announcement:<aid>:<uid>` 幂等、INSERT+审计同事务）+ `_admin.notifications.tsx` 撰写页 + `NotificationBell` 分支。link 安全分类器 `src/lib/announcementLink`（站内单层路径 / http(s) 外链）挡开放重定向。
    - **①增强：编辑 / 删除已发公告（新需求 2026-06-22，✅ 已实现）**：后台「已发公告」列表（按公告 id 聚合，显示目标〔审计回捞〕/ 接收数 / 已读数 / 时间）+ 每条**编辑**（批量改同一 `announcement:<aid>:%` 的 payload，可勾「重新提醒」=重置 `read_at` 重弹红点）/ **删除**（批量删该波 `notifications` 行）→ **同步用户端**。审计 `edit_announcement` / `delete_announcement`、二次确认、同事务。0 行命中→404。aid 经 `z.uuid()` → LIKE 无通配注入。
  - ② **用户端公告体验（新需求 2026-06-22，✅ 已实现）**：点铃铛公告 → **弹出详情弹窗**（完整 title/body/link 按钮/时间 + 知道了，关闭不删）；**看完仍保留**——铃铛列表改拉近 50 条全部（已读+未读）、未读淡陶土高亮·已读灰显、红点只计未读、关闭弹窗不删通知（修正现状「打开即已读 + 只查 unread → 看完消失」）。**连带修**：`image_expiring` 到期提醒在 cron 删图时连带删除（`deleteExpiredImages`），免拉全部后残留提醒滞留/挤占公告名额。
  - ③ （可选）**通知开关 / 参数（待开发）**：如「图片到期提醒提前天数」、各类通知启停，落 `app_config`（与全局参数同机制）。本轮不做。
  - 红线（已落实）：后台写端点 `requireAdmin` + 二次确认 + 操作审计（`broadcast_notification`）；广播 = 给目标用户**批量插 `notifications`**；前台只读本人通知（owner-scoped），`notifications.type` 枚举与 `NotificationItem` 契约同步扩。

- **后台 UX：顶部留白 / 页眉（新需求 2026-06-22，✅ 已实现）**：后台主区无 TopBar 横条、标题贴浏览器顶边（站长第 3 次反馈）；加**轻量 sticky 页眉**（含当前页标题，`.pageHead` 升级为 `position:sticky`）+ 顶部留白加大，与用户端观感对齐。**真因订正**：原 `Admin.module.css .main` 的 `padding` 引用了**未定义令牌** `var(--space-7)`（tokens.css 刻意缺省 7/9/11）→ 整条简写 substitution failure 失效=四边 0 内边距（不是留白不够），改用已定义令牌即修复。

> 运营进阶能力（客服 360 视图、配置中心+变更回滚、RBAC 权限分级、退款/争议）见 §23；合规与内容审核见 §21；工程一致性/幂等见 §22。

## 10. 历史回看（ChatGPT 式）

- **「最近」= 会话列表**：每次"新建生成"开新会话；再点新建把当前会话存进「最近」。点选**重新打开并可继续生图**（非只读）。
- **会话标题**：默认取首条提示词，单行最多 **20 字**超出 `…`。
- **重命名会话（新需求 2026-06-22，✅ 已实现）**：用户可在「最近」列表里给会话改名（行尾铅笔入口触发行内编辑；与删除入口并列）。owner-scoped、即时持久化，标题同步反映到顶栏「当前对话」。**用户改过名后以用户值为准，不再被默认「首条提示词」覆盖**（`enqueue` 仅创建会话时 set title）；空标题前后端双拦截。实现：`PATCH /api/conversations/:id` + `renameConversation`（reads.server.ts）+ `Sidebar.tsx` 行内编辑。
- 同会话内向上滚见更早生成。
- **搜索（P3-S2 已做）**：左栏「搜索」入口按**会话标题** ILIKE 检索、资产库按**提示词** ILIKE 检索（owner-scoped、参数化转义、250ms 防抖），点结果跳对应会话/图。

## 11. 本次对话图片面板

- 右侧常驻、可折叠（对话区头部"本次图片·N"开关）；仅当前会话成功图，最新高亮。
- 点缩略图 → 定位到对话流该轮 / 放大；可"下载全部"、单张"存入资产库"。
- **它就是"会话内的轻量工作台"**：可展开成网格视图。`本次面板 = generations WHERE conversation_id`，与资产库/最近是同份数据的不同查询，无需独立工作台、无需新表。
- 响应式：`≥1024px` 三栏；`<1024px` 面板收抽屉；`<768px` 侧栏也折叠。

## 12. 资产库（借鉴竞品并优化）

- 网格，**按日期 sticky 分组**：**今天 / 昨天 / 再早按具体日期**（如「6 月 19 日」「6 月 12 日」），分组头吸顶；显示全部生成图。
- **日期筛选（本期做）**：顶部提供日期筛选器——快捷项（今天 / 近 7 天 / 近 30 天）+ **自定义区间**（带日历的区间选择）。**组件要做精致好看**，不是一个朴素下拉。
- **批量多选**：桌面框选 + Shift 范围选，移动端长按进多选；选中后**底部浮出 action bar**（已选 N 张）：**下载（打包 zip）/ 删除（不可恢复，弹确认）**。
- 单张：**点击放大预览**、下载、删除、再生成。
- 仅展示用户**自己生成的图**；**本期不支持用户上传外部图片**到资产库。
- 排序/分页等后续；详细交互后面再具体聊。

## 13. 灵感库（借鉴竞品并优化）

- 卡片墙：**封面图为主体**，标题/一行摘要/「用此提示词」以**半透明渐变浮层叠在封面下半部**（上半部图全见）、品类标签浮左上；**封面保留原始比例的瀑布流（整图不裁切）以适配不定比例出图**。顶部**品类 Tab + 搜索**。视觉见 [design-system.html](prototypes/design-system.html) 第 10 节。
- **一键带回**：点"用此提示词" → **直接把 prompt 注入当前对话的 Composer 并滚到底**，不跳新页、不打断心流（照 Ideogram Remix）。
- 站长在后台手动维护（§9 灵感库 CRUD，封面图由站长上传）；**另支持用户投稿自己的作品 → 站长审核通过后公开**（§13.1，新需求 2026-06-23）。不从用户生成图自动收录。

### 13.1 用户投稿与审核（新需求 2026-06-23）

> 让用户把**自己生成的作品**投稿进灵感库，**先进站长后台审核队列**，**审核通过才上架**、全站可见。落地追踪见 [docs/dev/INSPIRATION-UGC-PLAN.md](dev/INSPIRATION-UGC-PLAN.md)。

**四项关键产品决策（站长 2026-06-23 拍板）：**
1. **投稿图来源 = 仅「我的作品」**。只能从用户**自己已生成**的图中选一张投稿（不开放本地任意图上传）。图已在我们存储里、提示词已知 → 滥用面小、信息全。
2. **填写项 = 用户填完整信息**。投稿时填 **标题（必填）/ 提示词（默认带回原图提示词、可改）/ 分类（可选）/ 简介（可选）**；管理员审核时可再修改后通过。
3. **入口 = 灵感库页面「投稿」按钮**。在 `/inspiration` 顶部放「投稿」按钮 → 弹窗内从「我的作品」选图 + 填表提交；弹窗内含「我的投稿」记录（看审核状态）。
4. **署名 = 公开卡片显示投稿人**。审核通过的卡片标注「由 X 投稿」；X = **投稿人邮箱前缀掩码**（如 `qkb964…@…` → `qk***`，隐私默认，不暴露完整邮箱；后续若加昵称字段可换）。站长自建的卡片无投稿人、不显署名。

**端到端流程：**
1. 用户在灵感库点「投稿」→ 选自己的一张作品 → 标题/提示词/分类/简介（提示词预填该图原 prompt）→ 提交。
2. 提交即把该图**复制一份到永久存储**（`inspirations/submissions/<uid>/…`），写一条 `inspiration_submissions`（`status='pending'`）。**不扣积分**（与所有上传一致，只有生图扣费）。
3. 管理员在后台「灵感投稿」队列看到待审：图 + 提交人 + 标题/提示词/分类/简介。可**通过**（可先改字段）或**驳回**（填原因）。一经审核即终态、不可反复。
4. **通过** → 在 `inspirations` 建一张上架卡（`active=true`、`cover` 用投稿图、带署名）→ 全站可见；投稿记录置 `approved`。**驳回** → 投稿记录置 `rejected` + 原因。
5. 两种结果都给投稿人发**站内通知**（铃铛，新类型 `inspiration_reviewed`，含状态/标题/驳回原因）。

**约束与防护（红线）：**
- **越权防护**：投稿只接受 `imageId`；服务端按 `images.user_id=$me` 校验归属后，**自行从 DB 取** storage_key / public_url / 宽高 / 原 prompt（绝不信客户端传的 key/url）。
- **待审图防误删**：孤儿清理 cron 的 known-set **新增保护** `inspiration_submissions WHERE status='pending'` 的 `image_key`——否则待审图 1 小时后会被当孤儿删掉。通过后保护转移到 `inspirations.cover_key`；驳回后不再保护 → 自动按孤儿回收。
- **防滥用**：每用户**待审上限**（默认 10 条，超出报错）+ **投稿限流**（events 计数，默认 10 次/10 分钟）+ **同图去重**（同一张图已有 pending/approved 投稿则拒）。
- **内容风险**：本期仍**不做自动内容审核**（§21）——管理员人工审核即唯一闸门，公开内容由站长把关、风险自担。
- **存储一致**：投稿副本独立于用户原图生命周期（用户删原图/原图到期清理**不影响**已通过的公开卡片，因封面是独立永久副本）。

## 14. 并发与防滥用

- **system 并发**：每用户**默认最多 2 个**进行中生成任务，**后台可逐用户调整**；超出再提交 → 提示“**超出并发数量**”。并发计数 = 进行中(`queued/claimed/running`)任务数；终态自动释放。**生成一旦开始不可取消。**
- **custom 并发**：不读取 `max_concurrency`，不做账户并发、提交限流、余额或系统预算拦截；允许前一张未完成时继续提交。仅保留同一次点击的防双击保护。本站 compute/DB/存储与流量成本风险已由站长接受。
- **system 计费即防滥用主闸**：2 次免费(0.14 积分)用完即需付费，天然限制白嫖。
- **本期不加**注册 IP 限流 / 全站每日赠送上限（你的决定）。残留风险：不验证邮箱可批量注册薅"2 次免费"——单账号仅 0.14 积分、损失有限，先接受。
- **Key / 成本防护**：system 继续使用积分闸与单日预算熔断。custom 使用用户自己的 Key，明确不计系统预算且不加平台并发/限流；仍由本站承担 worker、数据库、对象存储与流量成本，该敞口已接受。两种模式都依赖 generation 抢占状态机防同一任务重复执行。

## 15. 系统架构（技术选型已定稿；三步演进）

> **当前生产选型（完整技术设计见开发文档）。** Debian Docker Compose 运行 Caddy/现有代理、SSR web、worker、单例 scheduler 和 PostgreSQL 17；DB-as-queue，钱/码使用标准 `pg` pool 事务 + `FOR UPDATE`；ORM 为 Drizzle；前端为 React Router 8 framework 模式 + Vite 8 + React 19；鉴权为 Better Auth；媒体默认写本机 `media_data` 并以 `/media/*` 读取。Neon 与 S3 兼容存储保留为显式可选驱动，不是自托管依赖。质量门禁为 Vitest、Docker smoke、秘密扫描与 GitHub Actions。
>
> **因「中转 api.tangguo.xin = 同步阻塞」的 4 条成本约束**：① system 保留单日预算熔断，custom 明确绕过且风险已接受；② 持续实测单图 worker/主机与存储成本；③ generations 抢占式状态机防 worker 重领/scheduler 重扫重复下单；④ system 只读服务端全局 Key，custom 只读 generation-scoped 加密临时凭据。
>
> **安全边界**：构建期继续断言 system/基础设施 secret 永不进 bundle；另以运行时哨兵证明 custom Key 只存在于按 user ID 命名空间化的 `localStorage`、本次 HTTPS 请求体与服务端临时密文，不进入日志、错误、事件、审计或响应。

**第一步 · 已完成的现状修复（保持回归）**
- 生成由独立 worker 消费 durable queue；同步 HTTP handler 只入队并返回 `202`，不得在请求内等待 relay/job。
- v1 system 路径曾把已删除的 `src/server/imageProxy.ts` 中 Key 从请求体 `apiKey` 改为服务端 `RELAY_API_KEY` 并删除旧全局密钥 UI；新 custom 只按 §25 的受控链路实现，不恢复旧请求/jobStore 传 Key 方案。
- 前端使用 owner-scoped 批量短轮询查询当前会话所有非终态 generation。system/custom 均以服务端 `deadline_at` 为准、创建后最多 5 分钟；不上 SSE/WebSocket。

**第二步 · 上数据库 + 可靠队列（落地积分必做）**
- **数据库**：自托管 PostgreSQL 承载用户、积分账本、批次、兑换码、会话、生成、图片、审计和事件。job 态以 **`generations` 表**为准。只读和单语句操作走 read pool；扣费/FIFO/注册发放等多语句事务必须走 transaction pool。常驻进程复用 pool 并在退出时关闭。
- **队列**：不引独立队列服务——用 **generations 表状态机**（`queued→claimed→running→succeeded/failed`）+ worker 消费 + scheduler deadline 重扫。去重/幂等靠 `generation_id` 和原子抢占 `UPDATE…WHERE status='queued' RETURNING`。量大后才评估 Redis/Valkey + BullMQ，业务状态仍以 generations 为准。
- **媒体存储**：结果图从中转站临时 URL/base64 落到本机持久卷；DB 存 `storage_key + /media/<key>`，前端只读稳定 URL。S3 兼容后端仍可通过服务端 `STORAGE_*` 显式选择，历史 helper 名不代表当前供应商。
- **幂等主键**：一个 `generation_id` 贯穿"提交 → 生图 → 落图 → 扣费"。
- **扣费事务**：成功时单事务内「锁批次 → FIFO 扣减 → insert images → debit → 更新余额 → 标记成功」（可执行步骤与部分唯一索引见 §22 / §16）。
- **provider 调用**：当前 relay 为同步接口，由常驻 worker 调用并受 `deadline_at` 约束；前端只轮询本站状态，不直连 provider。

**第三步 · 规模化（延后）**：先按实测扩 worker；只有 PostgreSQL polling 吞吐不足时再评估 Redis/Valkey + BullMQ。

## 16. 数据库 Schema（草案，参考调研）

PostgreSQL。**金额一律用整数**（定死）：积分列用**毫积分 BIGINT**（1 积分=1000，0.07 积分=70），现金列用**分 BIGINT**（¥9.9=990）；绝不用 float / NUMERIC。下列所有 `credits/granted/remaining/amount/balance/credits_value` 均毫积分，`cash_value/price_cash` 均分。

- **users**(id, email unique, password_hash, role, max_concurrency default 2, created_at)
- **credit_accounts**(user_id pk/fk, balance, updated_at) — 物化余额
- **credit_ledger**(id, user_id, entry_type[grant=注册赠送|credit=兑换充值|debit=扣费|refund=退款|expire=过期|adjust=手动], amount_mp BIGINT>0, balance_after_mp, reason, ref_type, ref_id, created_at) — 只追加审计。**幂等用部分唯一索引（合法 Postgres 写法，约束里不能写谓词）**：
  - `CREATE UNIQUE INDEX uq_debit ON credit_ledger(ref_id) WHERE entry_type='debit'`（ref_type=generation、ref_id=generation_id）
  - `uq_refund … WHERE entry_type='refund'`（ref_id=generation_id）
  - `uq_grant_signup … WHERE entry_type='grant' AND ref_type='signup'`（ref_id=user_id）
  - `uq_credit_code … WHERE entry_type='credit'`（ref_type=code、ref_id=code_id）
  - `uq_expire_lot … WHERE entry_type='expire'`（ref_type=lot、ref_id=lot_id）
- **credit_lots**(id, user_id, source[signup|code], code_id null, granted, **remaining**, **expires_at（null=永久不过期）**, created_at) — 积分批次；消费按 `expires_at ASC NULLS LAST` 扣 remaining（永久批次最后扣）；过期 cron 清零。余额 = `SUM(remaining) WHERE remaining>0 AND (expires_at IS NULL OR expires_at>now())`
- **packages**(id, title, **description（套餐描述/适用场景，可空，前台 2 行内展示）**, price_cash, credits, **valid_days（积分有效期天数，null=永久）**, redirect_url, sort, active) — 充值套餐（后台 CRUD）
- **redeem_codes**(id, code unique, **package_id（决定积分/面值/有效期）**, credits_value, cash_value（面值现金，用于按面值记收入）, status[active|redeemed|disabled], batch_id, redeemed_by, redeemed_at, created_at) — 兑换时按 `package.valid_days` 给新批次设 `expires_at`
- **conversations**(id, user_id, title, created_at, updated_at)
- **generations**(id, conversation_id, user_id, prompt, model[固定 gpt-image-2], size, quality, background, moderation, **credential_mode[system|custom] default system**, **deadline_at**, **status[queued|claimed|running|succeeded|failed]**, job_id, error, credits_charged, **started_at, completed_at, duration_ms**, created_at, updated_at) — `duration_ms = completed_at − started_at`；in-flight = `queued/claimed/running`。`deadline_at` 对新任务固定为创建时刻 + 5 分钟，迁移需兼容存量 system 行。
- **generation_credentials**(generation_id pk/fk cascade, ciphertext, iv, auth_tag/由密文格式携带, key_version, expires_at, created_at) — 只供 custom generation 保存 AES-GCM/KMS 等价密文；不得保存明文、Base URL 或用户级长期配置。终态立即删；数据库 `now()+10min` 计算 `expires_at`，cleanup 每 5 分钟按数据库时钟删除，正常最迟 15 分钟物理删除。
- **images**(id, generation_id unique, user_id, storage_key, public_url, content_type, width, height, size_bytes, is_public default false, expires_at null, created_at)
- **audit_log**(id, admin_id, action, target_type, target_id, before jsonb, after jsonb, ip, reason, created_at) — 管理员敏感操作；只追加、管理员不可改自己的记录
- **events**(id, type[user_registered|image_succeeded|image_failed(含 reason)|code_redeemed|credit_granted|credit_consumed|credit_expired|image_cleaned], user_id, payload jsonb, created_at) — **append-only 事实表，数据看板全部从它聚合**（job/历史清理后不丢数据）

**二级索引**（高频查询防全表扫）：`generations(conversation_id)`、`generations(user_id,created_at)`、`generations(status,created_at)`、`images(user_id,created_at)`、`images(expires_at)`、`credit_lots(user_id,expires_at)`、`credit_ledger(user_id,created_at)`、`redeem_codes(batch_id)`、`events(type,created_at)`。

**并发计数**：不设独立计数列；system 账户并发 = `COUNT(*) FROM generations WHERE user_id=? AND credential_mode='system' AND status IN('queued','claimed','running')`。custom in-flight 可单独观测，但不占 `max_concurrency`；任务进终态自动释放。

> **Better Auth 的会话表同库**：`user / session / account / verification` 四张表（Better Auth 管理）与上述业务表共用同一 PostgreSQL、各管各事务、互不干扰（钱/码事务只碰 credit_lots/redeem_codes/ledger 等）。`users` 业务字段（role、max_concurrency 等）与 Better Auth 的 user 表对齐方式在开发文档定。

> job 状态以 **generations 表（Postgres）为准**，前端短轮询直接查它（不再用 Blobs 存 job 态）。本次面板 = `generations WHERE conversation_id`；资产库 = `images WHERE user_id`；最近 = `conversations WHERE user_id`。

## 17. 视觉规范（已定稿 → 可执行真相源见 [design-system.html](prototypes/design-system.html)）

> 视觉风格已确认。**设计令牌（颜色/字体/圆角/间距/阴影）的可执行真相源是 [docs/prototypes/design-system.html](prototypes/design-system.html)**（明暗两套、含全部组件样例与用法红线；研发取值一律引其 CSS 变量，不再硬编码）。下列为要点与红线。

**基调（已定）**：**亮色默认 + 暗色一键可切**；**柔和现代**（大圆角 / 充足留白 / 0.5px 细边）；**系统字体栈**（中文走各平台原生黑体苹方/微软雅黑/思源、拉丁走 Inter，零加载）。

**颜色**：
- 中性面=**微暖中性灰**：页面底 `#faf9f7` / 卡片 `#ffffff` / 次级填充 `#f3f2ef` / hover `#ecebe5`；文字 `#1a1a18 / #6c6b66 / #9b9a93`。暗色单独调校（非简单反相）：底 `#141310` / 卡片 `#1e1d1a` / 主文字 `#f5f3ee`。
- **主操作恒为黑**（`#1a1a18` 白字）；**暗色下反相为浅底深字** `#f5f3ee`，保最高对比。
- **暖色点缀**：唯一强调色 `#C26A3D`（暖陶土；浅底 `#F7EDE5`、其上文字 `#8C4A24`；暗色提亮 `#E0935E`）。**只用于 4 处：推荐/更划算徽章、选中/激活点睛、链接 hover、推荐档卡片描边；主操作仍黑、绝不大面积铺。**
- 圆角：卡片 16 / 输入·下拉 12 / 药丸·按钮·发送键 full。字阶 display 28 → micro 11，字重仅 400/500/600。层级靠 0.5px 细边 + 微阴影，不用重边框/大投影。

**关键组件（已定）**：
- 尺寸选中态：线框图标（未选浅描边、选中实心黑 + 黑边）。
- **生成中占位 = 宇宙星空动效**（非灰块、非纯转圈）：深空底 + 旋转银河 + 错峰星点 + 偶发掠星 + 角落呼吸光点 + `生成中 M:SS`；按所选比例自适应铺满、仅 transform·opacity、含 `prefers-reduced-motion` 降级；深空底为生成态专属、登记为 `--cosmic-*` token、**不随明暗反相**。
- **灵感卡**：封面为主体、标题/摘要/「用此提示词」以**半透明渐变浮层叠在封面下半部**（上半部图全见）、品类标签浮左上、按钮 hover 浮现转陶土；**封面保留图片原始比例的瀑布流（整图不裁切）以适配 1:1 / 2:3 / 3:2 / 16:9 等不定比例出图**。
- **所有图片支持点击放大预览（lightbox）**：点任意图 → **屏幕居中的模态浮层**（暗遮罩覆盖全屏、点遮罩或 × 关闭）；**浮层内仅提供「下载」，不放「再生成」**。对话流、本次面板、资产库、灵感库、后台生成记录处通用。
- Toast：右上角（移动端顶部），成功/失败/提示三类（绿/红/中性），自动 3 秒。

## 18. 与现有实现的衔接

- **复用**：尺寸选项 [sizeOptions.ts](../src/components/composer/sizeOptions.ts)、响应解析 [imageGeneration.ts](../src/api/imageGeneration.ts)、脱敏 [redaction.ts](../src/lib/redaction.ts)、异步代理骨架 [src/server](../src/server) + [netlify/functions](../netlify/functions)。
- **既有重构**：已删除的 v1 `src/App.tsx` 双栏壳 → Composer 三栏壳；质量/背景/审核进高级设置；移除 v1 无身份、无隔离的全局前端密钥链路；生成任务由持久 worker 执行。
- **🔑 v1 apiKey 清理与新 custom 例外的边界**：旧 `imageProxy.ts → proxyGeneration.ts → jobStore` 明文 Key 链路仍属禁止。新 custom Key 只允许按 user ID 存本地、经统一 `/api/generate` 上送并立即转 generation-scoped 密文；任何普通 generation/job/log/response 字段或兼容触发载荷仍不得携带 Key。
- **净新增**：注册登录、Postgres、对象存储、队列、积分账本、兑换码、后台管理、并发控制。

## 19. 已确认决策

> **产品决策已全部拍板。** system 保留赠送、FIFO、余额、默认并发、单日预算与成功扣费；custom 使用用户自己的单 Key、固定 Base URL、零扣费、零余额/预算/并发/提交限流且不自动回退 system。两种模式共用 `/api/generate`、图片存储和 5 分钟 deadline。完整矩阵见 §25。
>
> **技术实现已完成自动化与生产基础验证**：标准 PostgreSQL 事务、AES-GCM 临时凭据、批量状态、5 分钟终态竞争和空数据 Compose 持久化 smoke 已有证据。真实 Relay、目标主机容量与单图成本按运维周期观察，状态只看 [PROGRESS.md](PROGRESS.md)。
>
> **残留风险（已接受）**：不验证邮箱 → 新号 0.14 免费额度可被批量注册薅、烧共享 Key/compute 额度（由单日预算熔断兜底）。日后若被规模化薅再补防护。

## 20. 历史分期

- [x] 阶段一：Composer、五态、灵感画廊和主题。
- [x] 阶段二：账号、PostgreSQL、媒体存储、积分/兑换、后台、历史与资产库。
- [x] 阶段三已选范围：搜索、资产增强、灵感运营与图生图。

未选择的客服/RBAC、一次多图、画笔/蒙版/扩图式专业编辑器和应用层合规能力不属于当前待发布清单。当前对话内的文字描述二次编辑见 §26。

## 21. 内容审核与合规（本期不做，站长决定）

> 站长决定**本期不做**应用层内容审核与中国 AIGC 合规（备案 / AI 生成标识 / 日志留存 / 真人红线）。
- 本期仅**依赖中转/模型自带审核**（生成请求里的 `moderation` 参数**全站固定「宽松」**）。
- **风险存档（备查、非阻塞）**：面向境内公众的 AIGC 站，在备案、AI 生成内容标识、写实/真人内容上存在监管与支付通道合规风险；当前为站长知情后的自担决定。日后如需合法公开再回到此节补齐：备案、出图打标识、prompt 拦词 + 出图复核、举报入口。

## 22. 工程一致性与幂等（关键约束，落地必守）

> 钱/码/并发在并发与重试下极易出错，以下为必守做法（参考调研）。

- **金额用整数 milliPoints**（1 积分=1000，0.07 积分=70），杜绝浮点漂移；仅展示用小数。
- **出图成功事务按模式分流**：system 保留既有“落图 → 锁批次 → FIFO debit → 图片/事件/成功终态”的幂等事务。custom 使用独立幂等事务，只写图片、成功事件、`credits_charged_mp=0` 与成功终态，不锁/改 `credit_accounts`、`credit_lots`、`credit_ledger`，并删除临时凭据。两条分支都必须以 generation 行锁/状态谓词与 `images.generation_id` 唯一约束防重。
- **同号并发双花**：扣费用 `SELECT...FOR UPDATE` 行锁或 SERIALIZABLE。
- **兑换码**：单条 `UPDATE...WHERE code=? AND status='active' RETURNING`，`affected=1` 才入账；台账 `(code,user_id)` 唯一；错误码区分 404/410/400/429。
- **注册=原子发放**：注册在**单事务**内 `insert users + credit_accounts + 建 signup 批次(credit_lots, 30 天到期) + grant 流水`，以 `uq_grant_signup`(ref_id=user_id) 幂等（重试不重发 0.14，杜绝"建号成功但没发积分"窗口）。
- **中转 = 同步阻塞（已确认，无 webhook）**：由 worker 长 await（最长 5min）取结果；幂等靠 **generation 抢占式状态机 + `generation_id` 部分唯一索引**，扣费再以 `uq_debit(ref_id=generation_id)` 防重复扣。
- **并发与 deadline**：system 入队仍按 in-flight COUNT 对 `max_concurrency`；custom 不做该判断。两种模式创建 generation 时写 `deadline_at=created_at+5min`，上游 fetch 最迟在 `deadline_at-30s` abort；状态读取可原子把过期 `queued/claimed/running` 收为 `failed/provider_timeout`，cron 仅作兜底。成功与超时用状态谓词/行锁保证只一个终态生效；无取消逻辑。
- **余额对账**：每日 cron 比对物化余额与 `SUM(credit_lots.remaining 未过期)`，不一致告警、以批次为准。
- **积分过期（FIFO + 幂等）**：发放即建批次 `credit_lots`（含 `expires_at`，**null=永久**）；消费 `ORDER BY expires_at ASC NULLS LAST` 扣 `remaining`（先扣最早过期、永久批次最后扣；同一事务、行锁防并发双花）；每日 cron 把 `expires_at<now() 且 remaining>0` 的批次清零 + 写 `expire` 流水（幂等键=lot_id，**永久批次跳过**），同步物化余额。
- **数据地基（历史迁移）**：已删除的 v1 `src/server/asyncImageJob.ts` `JobRecord`（只有 status/时间/原始 response）→ 迁到 `generations` 表（§16）并补 userId/model/size/duration/failureReason 等；`events`（§16）作看板唯一事实源。
- **失败原因归一化**：中转原始文案映射成有限枚举。
- **中转故障兜底**：fetch 设 timeout、重试退避、清晰文案、后台可切**备用中转 Base URL**。
- **system 单日预算熔断**：只统计/拦截 system 请求；custom 不读、不增该预算键。运维中持续分别观察两种模式的 compute、DB、存储与失败率，避免把 custom 平台成本混进 system 中转成本。

## 23. 非当前基线的候选增强

以下条目不属于已经批准并实现的 `0.2.0` 需求，也不是当前待办。未来若决定建设其中任一能力，应建立新的需求文档、设计和验收范围后再实施。

- **客服 360 视图**：输入邮箱即看余额/流水/兑换/生成历史(含失败原因)/并发/封禁；一键重发结果图、补偿积分(走台账+审计)、重置密码、解封。
- **配置中心**：充值档/赠送/文案/URL/定价/默认并发/保留期/中转 Base·Key·模型 收敛一处，分组+校验+改动写审计+可回滚。
- **RBAC 权限分级**（可后置）：超管(动钱/配置/发码)/审核员(只审内容)/客服(查与重发不改余额)；短期单管理员可降级为"单账号+审计"，但角色字段尽早进模型。
- **退款/争议**：区分"撤销赠送积分"(后台直接)与"退真金白银"(涉第三方店铺需对账)；走台账+审计，`balance_after` 不为负。
- **可观测性与告警**：中转成功率/延迟/余额耗尽、队列积压与超时、每日扣费数 vs 中转账单差异、兑换异常、对账不平 → 阈值告警。

## 24. 交互细节默认值（审查补全；均为合理默认，可后续微调）

1. **注册/登录错误（§4）**：邮箱已注册 → 后端 409，文案"该邮箱已注册，请直接登录"+「去登录」；密码规则 ≥6 位、前端校验、文案"密码至少 6 位"；注册成功自动登录进主页。**忘记密码**本期占位：登录页放「忘记密码?」链接 → 提示"请联系站长重置"（无邮件基建）。
2. **「最近」会话列表（§10）**：按 `updated_at` 倒序、竖向列表；首屏 20 条、下滑分页（每页 20）；空态"还没有对话，点「新建生成」开始吧"+淡图标。
3. **图片生成记录列表（§9）**：时间筛选 = 日期区间（默认近 7 天）、用户筛选 = 邮箱搜索框；默认按生成时间倒序；每页 50；失败行直显报错+状态码（已定）。
4. **兑换码错误码与文案（§7.3）**：输入框 blur 轻校验格式，提交才真核销；后端 → 不存在『兑换码无效』/已用『该兑换码已被使用』/已作废『兑换码已失效』/频繁失败(如 5 次/10 分钟)『尝试过多，请稍后再试』。**码格式**默认 18 位 base32（去 0/O/1/I/l）、无分隔。
5. **过期提醒（§6.1）**：积分 → 充值页余额旁 tooltip『X 积分将于 MM-DD 过期』，过期前 3 天起顶部积分药丸标黄点；图片 → 缩略图角标『N 天后过期』（剩 ≤3 天才显示）+『下载保留』，到期前 1 天发一条站内通知。
6. **存入资产库（§5.2）**：仅成功态结果可用；点击直接存（无弹窗/分类）；成功 toast『已存入资产库』；已存的按钮置灰。
7. **本次对话图片面板（§11）**：右侧常驻（≥1024px），网格 2 列、正方裁剪缩略图、按生成时间倒序、仅成功图；`<1024px` 收抽屉、`<768px` 底部抽屉；头部"本次·N"显示数量。
8. **资产库日期筛选（§12）**：单选；快捷默认「今天」；选「自定义」默认近 30 天区间、选完自动应用（无需确认按钮）；可选范围 = 注册日 ~ 今天；清除回到全部。
9. **资产库批量多选（§12）**：进「批量管理」后可选；桌面拖动框选 + Shift 连选 + 单击切换；选中浮出吸底 action bar；删除确认弹窗『确定删除选中的 N 张图? 删除后不可恢复』；下载 zip 命名 `图像工坊_导出_YYYYMMDD_HHmmss.zip`。
10. **灵感库一键带回（§13）**：仅登录且当前非生成中可用；输入框已有文本 → 弹确认『替换当前输入?』；仅回填提示词到 Composer 并滚到底，**不自动发送**。
11. **全局消息反馈（Toast 规范）**：右上角（移动端顶部）；成功 / 失败 / 提示三类（绿 / 红 / 中性）；自动消失 3 秒、可手动关；兑换成功、积分到账、存入资产库等关键操作给 toast。
12. **生成中占位格（§5）**：**宇宙星空动效**（深空底 + 旋转银河 + 错峰星点 + 偶发掠星 + 角落呼吸光点，**非纯转圈、非灰块**；视觉见 [design-system.html](prototypes/design-system.html) 第 8 节），内含『生成中 M:SS』；按所选比例自适应铺满（1:1 / 2:3 / 3:2 / 9:16 / 16:9），仅 transform·opacity、含 `prefers-reduced-motion` 降级。
13. **后台全局参数校验（§9）**：单张扣费 >0；新人赠送 ≥0；赠送有效期 ≥1 天或永久；保留期 ≥1 天；套餐价格/积分 >0；改动需二次确认 + 写审计（防误填负数/0）。
14. **Key 配置与多任务（§25）**：首次默认 system，浏览器按 user ID 记住最后模式；保存 custom Key 自动切 custom，切回 system 不删 Key，清除 Key 后切 system。custom 任务提交后 Composer 立即可继续使用；同一次操作防双击，但不等待前一任务完成。

## 25. 系统 Key / 自定义 Key 与多任务生成（2026-07-11 批准增补）

> 本节是批准功能的产品摘要；字段、错误码、安全边界和逐条验收以 [批准版 PRD](../tasks/prd-user-api-key-modes.md) 为准。生产 rollout 状态看 [PROGRESS.md](PROGRESS.md)。

| 维度 | system | custom |
|---|---|---|
| 入口 | `POST /api/generate` | 同一入口，不增 `/api/generate/custom` |
| 中转 | 现有后台 `app_config`，env 兜底 | 固定 `https://api.tangguo.xin/v1`，客户端不可改也不发送 URL |
| Key | 仅服务端全局配置 | user-scoped `localStorage` 明文 + HTTPS 请求；服务端 generation-scoped 密文 |
| 计费 | 保持余额校验、成功扣费、FIFO、账本 | 不查余额、不扣费；成功 `credits_charged_mp=0`，余额/批次/账本不变 |
| 防护 | system 并发只统计 system in-flight；保留系统日预算及既有限制 | 不限账户生成并发、不计系统预算/并发、不做生成提交限流；通用鉴权/参数/上传安全限制仍有效 |
| 失败 | 现有系统错误 | 精确映射 custom Key/配额/限流等错误；不自动回退 system，不清本地 Key |
| 存储 | 对象存储 + 会话历史 + 资产库 | 完全相同的存储、历史、资产与保留策略 |
| deadline | 创建后最多 5 分钟 | 同一 5 分钟规则 |

### 25.1 交互与本地配置

- 顶栏 `KeyRound` 图标打开模态框；system/custom 用单选或分段控件，custom Key 用密码输入并支持显隐、保存、清除，固定 URL 只读展示；tooltip/可访问名称包含当前 mode。
- 保存时只校验 trim 后非空与最多 500 字符，不探测上游、不产生测试图片。首次默认 system；按登录用户 ID 隔离本地键名，无跨设备同步。退出登录不删除该用户配置。
- SSR 水合与账号切换期间须有 ready gate，配置加载完成前不得提交；dialog 须有初始焦点、焦点圈定、Esc 关闭和触发点恢复。
- 浏览器明文存储带来的同源 XSS、恶意扩展和共享设备风险是明确接受的设计，不得宣传为端到端加密。
- “本站不扣积分”不代表第三方免费；用户自定义 Key 是否计费与退款以服务商规则为准。

### 25.2 请求、凭据与安全

- 新客户端必须显式发送 `credentialMode: "system" | "custom"`；旧请求缺 mode 且无 Key 时兼容为 system，缺 mode/system 却携带 Key 时固定 400。custom 必含 trim 后非空且最多 500 字符的 `customApiKey`；客户端永不提交 Base URL。
- 入队成功统一返回 `202 {generationId,conversationId,status,credentialMode,deadlineAt}`，客户端用服务端 deadline 校正乐观值。
- 自定义凭据与 generation 必须原子创建或具有等价补偿；任何兼容任务载荷只含 `generationId`。临时凭据终态立即删除；数据库时钟计算孤儿 10 分钟到期、scheduler 每 5 分钟清理，正常调度下最迟 15 分钟物理删除。
- Key 明文不得进入 generation 普通字段、图片、events、audit、Sentry、日志、错误字符串、用户/管理员响应；relay 边界脱敏器须覆盖本次真实 system（含 app_config 值）/custom Key。成功路径只返回解析图片，不带出原始 response body。
- custom 有服务端 fail-closed 运维开关：缺失或 `false` 时关闭，Debian 安装器为新部署显式写入 `true`。关闭时返回 `503 CUSTOM_KEY_MODES_DISABLED` 且零写入；UI 保留已存 Key但禁用 custom 提交，不能静默切 system；已打开页面首次收到 503 后立即刷新开关并进入暂停态。回滚先关入口，再以受审计脚本收口在途 custom 和删除凭据，清零前不得删除或轮换主密钥。

### 25.3 多任务、超时与错误

- custom 允许用户在第一张未完成时继续提交；system 保持同会话单项锁定。一个轮询控制器把全部非终态任务按每批 ≤50 IDs 自动分片、合并并按 ID 更新卡片；`missingIds` 必须显式收口，单项终态不停止其他项。
- 两种模式的权威 deadline 均为 generation 创建后 5 分钟；上游请求预留 30 秒做解析/落图/终态事务。状态接口可主动收口过期任务，cron 继续兜底。
- 超时统一 `provider_timeout`，文案“请求超时，本站未扣积分，请重试”。custom 使用 `custom_key_invalid`、`custom_key_quota`、`relay_rate_limited`、`relay_unreachable`、`invalid_request`、`content_rejected`、`invalid_response`、`storage_failed`、`unknown`；system 保留现有 `insufficient_quota` / `relay_5xx` 等语义，任何失败都不得自动改模式。

## 26. 对话结果图文字二次编辑（2026-07-14 批准增补）

> 完整交互、安全和验收规则见 [批准设计](superpowers/specs/2026-07-14-conversation-image-edit-design.md)。本节记录当前产品契约，不扩展为资产库/灵感库入口或专业图片编辑器。

- 入口只出现在当前对话的成功且有图结果卡。点击后复用底部 Composer 进入编辑态，右侧“本次图片”保持不变。
- 编辑描述默认为空；尺寸、质量和背景继承来源 generation 且可修改。编辑态显示来源缩略图/ID和提交时当前 system/custom 模式，不重复显示单张价格文案。
- 提交继续使用 `POST /api/generate`，只新增 `sourceImageId`；它与临时上传的 `inputImageKey` 互斥，客户端不能提交 storage key、路径或外部 URL。
- 原 generation/image 永不修改。编辑创建同一对话的新 generation/image，新卡显示“基于此图编辑”和来源缩略图，并可继续编辑；重试复用来源 ID、描述和本轮参数。
- system 沿用余额、并发、预算和成功后一次 debit；custom 沿用任务级凭据和本站零扣费。失败、超时、来源不存在或不可读均不产生 system debit。
- 只有收到 `202` 后编辑态才关闭并定位到新卡；校验、权限和网络错误保留编辑描述与参数。来源不可用统一显示“这张图片已不可编辑”。
