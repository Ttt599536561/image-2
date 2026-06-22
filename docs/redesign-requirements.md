# AI 图像工坊 · 产品需求规格（v2 重构）

> 状态：需求讨论中（前期开发基线）。本文件是 v2 的**完整产品规格**——从 v1 双栏工具重构为"对话式生图 + 账号 + 积分计费 + 兑换码充值 + 后台管理"的公众站。
> 关联：[requirements.md](requirements.md)（v1 现状）、[development.md](development.md)（现有架构）、[test-cases.md](test-cases.md)（v1 用例）。
> 更新：2026-06-21。架构与数据模型部分参考了对市面生图产品的调研。

## 1. 背景与目标

- v1 是双栏表单工具、用户自带密钥。v2 重构为**面向公众、需注册登录、按积分计费**的对话式生图站。
- URL 与 Key 由站长写死在**服务端**，用户看不到、碰不到；用户**注册登录**后按**积分**付费生图。
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
- 服务端写死 URL+Key；删除前端密钥 UI。
- Composer 对话式主界面 + 五态。
- **积分计费**（按张扣费、成功才扣、余额展示）。
- **兑换码充值** + **充值页**（档位卡片跳第三方店铺）+ **兑换码入口**。
- **后台管理系统**（生成/管理兑换码、管理用户与积分、调并发）。
- 历史回看（「最近」会话列表）+ 本次对话图片面板。
- 资产库（日期分组、批量多选、删除/下载）。
- 灵感库（提示词库、搜索、标签、一键带回 Composer）。
- **并发控制**（每用户默认 2，后台可调）。
- 深色模式 + 暖色点缀。

### 2.2 本期 Out of Scope / 后续
- 图生图（参考图）：**新需求 2026-06-22，方案已过审、待开发**（Composer 已有「参考图」占位入口）。**前置**——先探测中转 `/images/edits` 端点是否支持 `gpt-image-2`（同 S6/#9 范式），通过才进入实现：上传单张参考图 → `/api/uploads` 存储 → `GenerateRequest.inputImageKey` → `generations.input_image_key` 列 → 管线 `callRelay` 有图走 edits multipart，计费同 0.07，上传图纳入保留期清理。详见 PROGRESS「第二批待开发队列」。
- 优化提示词：不实现，**按钮占位**。
- 一次多图（`n`>1）：不做，每次一张。
- 真实支付页 / 订阅：不做（走兑换码）。
- 邮箱验证码：不做（注册即用）；找回密码后置。
- 单图编辑（局部重绘/扩图）、资产库高级管理：后续。

## 3. 信息架构 / 导航

- **登录门槛**：未登录 → 跳注册/登录页，不能生图；**不做单独落地页**，入口即登录页。
- **左侧侧栏**（可折叠为图标栏）：新建生成、搜索、最近（会话）、资产库、灵感库；底部账号区（标识 + 退出）。
- **右上角**：**当前积分余额**（点击进充值页）、深色模式切换。对话区头部有"本次图片"开关。
- **无任何中转站/密钥 UI**。
- **后台管理**：独立后台路径（仅管理员），见 §9。

## 4. 账号（注册登录）

- 必须登录才能用；独立注册/登录页。
- 凭据：**邮箱 + 密码**；不做邮箱验证；找回密码后置。
- 密码用 `bcryptjs`（纯 JS，适配 serverless）加盐哈希存储。
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

### 5.1 Composer 构成
默认一排药丸 + 发送键：
- **参考图（+）**：占位"敬请期待"。
- **模型**：**全站固定 `gpt-image-2`**，不提供模型选择（Composer 不再有模型药丸；如需可在某处只读展示"当前模型 gpt-image-2"）。因此看板不做"模型占比"。
- **比例（尺寸唯一入口）**：点击弹浮层，复用现有 6 个场景选项：`智能 auto / 1:1 1024×1024 / 2:3 1024×1536 / 3:2 1536×1024 / 9:16 1088×1920 / 16:9 1920×1088`。
- **高级设置**：浮层，含**质量、背景**两项。**审核（moderation）全站固定「宽松」(low)**，不作为可选项。
- **优化提示词**：占位"敬请期待"。
- **发送**：黑色圆形。
- **数量固定 1**。
- **生成前**在 Composer 旁显示：**本次消耗 0.07 积分 / 剩余 Y 积分**（每次 1 张、固定 0.07，不写"约"）。

### 5.2 成功态（操作挂在每一轮结果上）
单张成品图 + "已完成"标记。每轮结果旁的按钮只作用于该轮：**下载 / 重新生成（回填提示词+参数到输入框，可改再发）/ 复制提示词 / 查看原始响应(脱敏) / 存入资产库**。"用作参考"属图生图，本期不做。

### 5.3 失败
报错沿用现有映射（404/502 upstream/502 无法连达/504/CORS），**脱敏**防站长 Key 泄露；失败格明确"未扣/已退积分"。**生成中不可取消**——任务一旦开始就跑到成功或失败/超时为止（无取消按钮、无"已取消"态）。

## 6. 积分与计费

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
- 到期由定时任务（cron，可用 Netlify Scheduled Functions）**自动清理**：删对象存储文件 + 删/标记数据库记录。
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

- **兑换码管理**：批量生成（指定面额/数量/批次 `batch_id`）、导出 CSV（给店铺）、查询单码状态、作废批次、对账（某批发出/已用/未用/金额）。
- **用户管理**：搜索；用户详情（余额 + 流水 + 会话/图片数 + 并发 + 注册/活跃时间）；每行操作（**封禁/解封、改密、增减积分（走 `adjust` 流水、必填原因）、增减并发、看详情**）收进行尾的**「⋯」下拉菜单**，不平铺成一排链接。
- **灵感库管理（CRUD）**：新增/编辑/删除灵感卡（封面图、标题、品类标签、提示词、摘要、排序、是否上架）。
- **图片生成记录（列表形式）**：以**列表/表格**展示**所有用户的生成记录**（小缩略图 + 所属用户 + 生图时长 + 提示词 + 状态 + 时间），可按用户/时间筛选、分页，一屏看多条不用一直下滑；**点缩略图即放大**（无需单独"放大"按钮）。**失败行直接显示报错原因 + 状态码**（如「504 中转网关超时」），无需再点"查看错误"。**纯记录/排查用，不做"收录灵感库"等操作。**
- **套餐管理（CRUD）**：以列表展示充值套餐，可**新建/编辑/删除**。每个套餐字段：**套餐标题、套餐描述（适用场景/人群，可空，多行输入、前台 2 行内展示）、价格、积分、有效期（= 该套餐积分兑换后多少天过期，**可设「永久」**）、跳转 URL、排序、是否上架**。
- **全局参数（后台可改、不写死）**：单张扣费价（0.07）、新用户赠送额（0.14）、**新用户赠送有效期（天，默认 30）**、保留期天数（免费 7 / 付费 60）。
- **数据看板（本期最小 7 卡）**：①今日注册数 ②今日成功/失败次数 + **失败原因 Top**（归一化枚举：额度不足/relay_5xx/超时/未知）③累计总图数 ④今日/累计**收入**（兑换成功按**面值现金** ¥9.9/¥29.9 记账）⑤**积分发放 vs 消耗 + 账面负债**（赠送与充值分列）⑥**队列健康**（待处理/运行中）⑦**平均生图时长**。再加：付费转化率/ARPU、DAU、尺寸占比。
- **操作审计日志（本期做）**：管理员敏感操作（调积分、改密、封禁、生成/作废码、改配置/定价/文案/Key）留痕（管理员 ID、时间、对象、动作、变更前后值、IP、原因）；**只追加、管理员不可删改自己的记录**。
- **站内通知配置 / 管理（新需求 2026-06-22）**：现状——站内通知**仅 `image_expiring`**（图片到期前 1 天 cron 自动产出）。本需求让管理员能在后台**创建并下发站内通知**，让前台铃铛不只有自动到期提醒。
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
- 本期由**站长在后台手动维护**（§9 灵感库 CRUD，封面图由站长上传）。**本期不支持用户上传到灵感库**，也不从用户生成图自动收录，后期有机会再做。

## 14. 并发与防滥用

- **并发**：每用户**默认最多 2 个**进行中生成任务，**后台可逐用户调整**；超出再提交 → 提示"**超出并发数量**"。并发计数 = 进行中(`queued/claimed/running`)任务数；任务进入终态(成功/失败/**5 分钟超时**)必须正确**释放计数**，否则会卡满并发（见 §22）。**生成一旦开始不可取消。**
- **计费即防滥用主闸**：2 次免费(0.14 积分)用完即需付费，天然限制白嫖。
- **本期不加**注册 IP 限流 / 全站每日赠送上限（你的决定）。残留风险：不验证邮箱可批量注册薅"2 次免费"——单账号仅 0.14 积分、损失有限，先接受。
- **Key / 成本防护**：靠**每用户积分闸口**（积分不足即拦、不入队列，§6）——付费用户烧自己买的积分。**做「单日预算熔断」**（应用层硬上限：当日中转调用/compute 消耗超阈值即拦生成入口 + 告警）。⚠️ 此处由原「不做全站预算熔断」**修订为「做」**——技术选型发现 Netlify 无全局消费帽 + 中转同步阻塞使后台函数按墙钟烧 compute、平台自动重试还放大,预算熔断成为防站长破产的唯一硬上限（见 §15 铁律 / §22）。**子 Key 仍不做**（一把共享 Key；待确认中转是否支持子 Key）。残留风险：新号 0.14 免费额度可被批量注册薅、烧共享 Key/compute，由单日熔断兜底、站长已接受。

## 15. 系统架构（技术选型已定稿；三步演进）

> **技术选型已锁定（完整技术设计见开发文档）。** 栈：部署 **Netlify**（Background Functions 15min 跑 5min 生图 / Scheduled Functions 跑 cron / 阶段一 **DB-as-queue** 用 generations 状态机做队列，不引独立队列服务）；DB **Neon Postgres**（钱/码 `@neondatabase/serverless` **Pool/WS** 事务+`FOR UPDATE`，看板 HTTP；region 选 AWS 美东与 Netlify 函数同区）；ORM **Drizzle**+drizzle-kit（关键幂等约束手写校对 SQL）；前端 **React Router 7 framework 模式**+Vite+React 19；鉴权 **Better Auth**（DB 可吊销会话+admin 插件+bcryptjs，钉版避 multi-session CVE、敏感路径每请求查 DB 硬校验）；存储 **R2**（公有 bucket+不可枚举 URL+自定义域）；API 手写 REST(202+短轮询、语义化状态码)+**TanStack Query v5**+**Zod4/drizzle-zod**（`src/contracts` 单一真相源）；样式 tokens.css+CSS Modules；质量 Vitest(真 Neon 分支测钱链路)+Playwright 冒烟+**Biome**+Sentry+GitHub Actions。**已排除** Next.js/TanStack Start、MySQL/PlanetScale（缺部分唯一索引+RETURNING、serverless 生态弱）、Supabase（鉴权/存储已另选）。
>
> **⚠️ 因「中转 api.tangguo.xin = 同步阻塞」（用户拍板按最坏设计）的 4 条成本铁律**：① **单日预算熔断**（应用层硬上限，Netlify 无全局消费帽 → §14 已由「不做全站熔断」修订为「做单日熔断」）；② 上线前**实测单图 GB-hour compute 成本**（中转 p50/p95 时长 × 内存档 × 10 credits/GB-hour）对账 0.07 积分确认毛利，后台函数内存档调低（多为空等中转）；③ generations **抢占式状态机**防平台自动重试(1/2min)+cron 重扫的重复扣费/重复下单（见 §16 status + §22）；④ 先修现存硬伤（见第一步）。
>
> **开发文档待压测/定清**：Neon **direct vs pooled endpoint**（`FOR UPDATE` 真锁 vs `max_connections`，倾向 direct+同区，压并发验证）；Better Auth 封禁/改密敏感路径**每请求查 DB**（不走 cookieCache 300s 窗口）+ 注册限密码长度防 bcrypt 72 字节截断；毫积分跨 JSON（单笔 number、看板 SUM 走 string codec）；构建期断言中转 env(apiKey/baseUrl) 永不进前端 bundle。

**第一步 · 修现状隐患（本期必做）**
- 把 [generate.ts](netlify/functions/generate.ts) 里"用 `fetch` 主动调 generate-background"改成**真正的 Netlify Background Function**（拿回 15 分钟时长与平台重试）；普通同步函数 10s/26s 会被生图打超时。
- [imageProxy.ts](src/server/imageProxy.ts) 的 Key 从请求体 `apiKey` 改为读**服务端环境变量 `RELAY_API_KEY`**；删前端密钥 UI。
- 前端继续**短轮询** `generate-status`（每 2 秒、**上限 5 分钟**：5 分钟无结果即判失败、释放并发、不扣费）。对话式每次只等一张、状态变更少，**短轮询足够，不上 SSE/WebSocket**。

**第二步 · 上数据库 + 可靠队列（落地积分必做）**
- **数据库**：Serverless Postgres（**Neon**），承载用户/积分账本/批次/兑换码/会话/生成/图片/审计/事件等强一致数据。**Netlify Blobs 是 KV、最终一致、无原子操作，绝不放余额/兑换码/job 态**；**job 态迁 generations 表**（避免 60s 一致性坑）。**调用模式区分**：兑换核销可用 **HTTP 单语句**（`UPDATE…RETURNING` 已原子）；但**扣费/FIFO 扣批次/注册原子发放等多语句事务必须走 transaction（Pool / WebSocket）模式**——Neon HTTP 单语句模式不支持 `FOR UPDATE`/跨语句事务，用错幂等防双花会落空。DB client 单 handler 内开-用-关、不跨请求复用。
- **队列（阶段一 = DB-as-queue，已定）**：不引独立队列服务——用 **generations 表做状态机**（`queued→claimed→running→succeeded/failed`）+ Background Function 消费 + Scheduled Function 5min 兜底重扫。去重/幂等靠 `generation_id` 部分唯一索引 + **抢占式中间态**：后台函数入口 `UPDATE…WHERE status='queued' RETURNING` 抢占（抢不到即退，挡平台自动重试 1/2min 与 cron 重扫的重复扣费/重复下单）；调中转前按 generation_id 查重或带请求级幂等键防重复下单。**Netlify Async Workloads / Upstash QStash 留作量大后的平滑升级**（仍在 Netlify 内、不锁平台）。
- **对象存储**：结果图从中转站临时 URL/base64 **落到 Cloudflare R2**（S3 兼容、零出口费）；DB 只存 `storage_key + public_url`，前端永远读稳定 URL（否则历史/资产库整片裂图）。
- **幂等主键**：一个 `generation_id` 贯穿"提交 → 生图 → 落图 → 扣费"。
- **扣费事务**：成功时单事务内「锁批次 → FIFO 扣减 → insert images → debit → 更新余额 → 标记成功」（可执行步骤与部分唯一索引见 §22 / §16）。
- **provider 回调**：对接中转站时优先用其 webhook 回调替代"函数里 sleep 轮询 provider"；保持两层解耦——前端↔本站短轮询、本站↔provider webhook。

**第三步 · 规模化（延后）**：并发/时长继续增长再迁独立常驻 worker + Redis/BullMQ。

## 16. 数据库 Schema（草案，参考调研）

Neon Postgres。**金额一律用整数**（定死）：积分列用**毫积分 BIGINT**（1 积分=1000，0.07 积分=70），现金列用**分 BIGINT**（¥9.9=990）；绝不用 float / NUMERIC。下列所有 `credits/granted/remaining/amount/balance/credits_value` 均毫积分，`cash_value/price_cash` 均分。

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
- **generations**(id, conversation_id, user_id, prompt, model[固定 gpt-image-2], size, quality, background, moderation, **status[queued|claimed|running|succeeded|failed]**, job_id, error, credits_charged, **started_at, completed_at, duration_ms**, created_at, updated_at) — `duration_ms = completed_at − started_at`，用于"每次生图时长"与"平均生图时长"。**status 含抢占式中间态**（替代原 pending/running 二态）：入队=`queued`；后台函数 `UPDATE…WHERE status='queued' RETURNING` 抢占置 `claimed`（抢不到即退,防平台自动重试/cron 重扫重入）→ 调中转置 `running`（写 started_at）→ 落 R2 + 扣费事务后置终态。in-flight(并发) = `queued/claimed/running`。
- **images**(id, generation_id unique, user_id, storage_key, public_url, content_type, width, height, size_bytes, is_public default false, expires_at null, created_at)
- **audit_log**(id, admin_id, action, target_type, target_id, before jsonb, after jsonb, ip, reason, created_at) — 管理员敏感操作；只追加、管理员不可改自己的记录
- **events**(id, type[user_registered|image_succeeded|image_failed(含 reason)|code_redeemed|credit_granted|credit_consumed|credit_expired|image_cleaned], user_id, payload jsonb, created_at) — **append-only 事实表，数据看板全部从它聚合**（job/历史清理后不丢数据）

**二级索引**（高频查询防全表扫）：`generations(conversation_id)`、`generations(user_id,created_at)`、`generations(status,created_at)`、`images(user_id,created_at)`、`images(expires_at)`、`credit_lots(user_id,expires_at)`、`credit_ledger(user_id,created_at)`、`redeem_codes(batch_id)`、`events(type,created_at)`。

**并发计数**：不设独立计数列；并发 = `COUNT(*) FROM generations WHERE user_id=? AND status IN('queued','claimed','running')`（唯一事实源；任务进终态即自动释放，无双减/漏减）。

> **Better Auth 的会话表同库**：`user / session / account / verification` 四张表（Better Auth 管理）与上述业务表共用同一 Neon 库、各管各事务、互不干扰（钱/码事务只碰 credit_lots/redeem_codes/ledger 等）。`users` 业务字段（role、max_concurrency 等）与 Better Auth 的 user 表对齐方式在开发文档定。

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

- **复用**：尺寸选择器([GeneratorForm.tsx](src/components/GeneratorForm.tsx))、响应解析([imageGeneration.ts](src/api/imageGeneration.ts))、脱敏([redaction.ts](src/lib/redaction.ts))、异步代理骨架([src/server](src/server)+[netlify/functions](netlify/functions))。
- **重构/删除**：双栏 [App.tsx](src/App.tsx) → Composer 三栏壳；质量/背景/审核进高级设置；删前端密钥 UI/校验/存储；修 generate.ts 真后台函数。
- **🔑 全链路移除 apiKey（Key 泄露面比想象大）**：现状 `imageProxy.ts` 从请求体 `input.apiKey` 取 Key、`proxyGeneration.ts` 把 apiKey 放进 POST body、`generate.ts`/`runImageJob` 又把含 apiKey 的 `input` 传给后台函数与 jobStore——**全是泄露点**。改法：`ImageProxyInput` 删掉 `apiKey` 字段；前端不再上送；generate→generate-background→jobStore→runImageJob **链路不传、不持久化任何 Key**；代理只从 `process.env.RELAY_API_KEY` 注入。
- **净新增**：注册登录、Postgres、对象存储、队列、积分账本、兑换码、后台管理、并发控制。

## 19. 待确认

> **产品决策已全部拍板。** 速查：赠送有效期 30 天；充值档/套餐天数/跳转 URL 一律**后台自配**；防护=**每用户积分闸口 + 单日预算熔断**（**子 Key 不做——一把共享 Key**；⚠️ 单日预算熔断由原「不做全站熔断」**修订为「做」**，见 §14/§15）；消费 **FIFO（最早过期先扣）**；看板去掉"内容审核"；并发安全=**入队前判断余额 + 成功时行锁扣减不出负**。
>
> **技术侧待确认（不阻塞起步，开发文档定）**：① 中转是否支持独立子 Key / 请求级幂等键（决定重试是否会对中转重复下单）；② Neon **direct vs pooled endpoint**（压并发验证 `FOR UPDATE` 真锁、不撞 max_connections）；③ 单图 **GB-hour compute 成本实测** 对账 0.07 定价；④ 第三方店铺购买 URL 待给。
>
> **残留风险（已接受）**：不验证邮箱 → 新号 0.14 免费额度可被批量注册薅、烧共享 Key/compute 额度（由单日预算熔断兜底）。日后若被规模化薅再补防护。

## 20. 分期路线（建议）

- **阶段一 · 前端形态**：Composer 五态 + 尺寸/参数药丸 + 灵感画廊 + 深色/暖色；修 generate.ts 真后台 + 代理读 env key。（用 mock 账号/积分跑通体验）
- **阶段二 · 账号+积分+存储（公开上线前必需）**：注册登录 + Neon + 对象存储 + 队列 + 积分账本 + 扣费 + 兑换码 + 充值页 + 后台管理 + 历史/资产库/本次面板 + 并发控制 + **工程一致性/幂等（§22）**。
- **合规/审核**：本期**不做**（站长决定，§21）；如需合法公开再回补。
- **阶段三 · 增强**：搜索、资产库高级管理、灵感库运营化、客服/RBAC（§23）、优化提示词；（更远）图生图、一次多图、单图编辑。

## 21. 内容审核与合规（本期不做，站长决定）

> 站长决定**本期不做**应用层内容审核与中国 AIGC 合规（备案 / AI 生成标识 / 日志留存 / 真人红线）。
- 本期仅**依赖中转/模型自带审核**（生成请求里的 `moderation` 参数**全站固定「宽松」**）。
- **风险存档（备查、非阻塞）**：面向境内公众的 AIGC 站，在备案、AI 生成内容标识、写实/真人内容上存在监管与支付通道合规风险；当前为站长知情后的自担决定。日后如需合法公开再回到此节补齐：备案、出图打标识、prompt 拦词 + 出图复核、举报入口。

## 22. 工程一致性与幂等（关键约束，落地必守）

> 钱/码/并发在并发与重试下极易出错，以下为必守做法（参考调研）。

- **金额用整数 milliPoints**（1 积分=1000，0.07 积分=70），杜绝浮点漂移；仅展示用小数。
- **出图"成功"判定 + 扣费事务（可执行步骤）**：以**图落对象存储成功 + 写库成功**为准。先传 R2（事务外、结果存临时变量）→ 开**单事务**：① `SELECT … FOR UPDATE` 锁该用户 `credit_lots`（`ORDER BY expires_at ASC NULLS LAST`）；② 跨多批次扣够 70 毫积分（各批 `remaining` 不出负）；③ `insert images`；④ `insert credit_ledger(debit, ref_id=generation_id)`（命中 `uq_debit` 即已扣过、幂等）；⑤ 更新物化余额；⑥ `generations.status=succeeded` + 写 `events(image_succeeded)` → **提交**。任一步失败 → 回滚 + 异步 cron 清孤儿 R2 对象。这把"扣了图没存 / 图存了没扣 / 重复扣 / 余额负"全堵死。
- **同号并发双花**：扣费用 `SELECT...FOR UPDATE` 行锁或 SERIALIZABLE。
- **兑换码**：单条 `UPDATE...WHERE code=? AND status='active' RETURNING`，`affected=1` 才入账；台账 `(code,user_id)` 唯一；错误码区分 404/410/400/429。
- **注册=原子发放**：注册在**单事务**内 `insert users + credit_accounts + 建 signup 批次(credit_lots, 30 天到期) + grant 流水`，以 `uq_grant_signup`(ref_id=user_id) 幂等（重试不重发 0.14，杜绝"建号成功但没发积分"窗口）。
- **中转 = 同步阻塞（已确认，无 webhook）**：在 Background Function 内长 await（最长 5min）取结果；幂等不靠 webhook，而靠 **generation 抢占式状态机 + `generation_id` 部分唯一索引**——后台函数入口 `UPDATE…WHERE status='queued' RETURNING` 抢占（挡平台自动重试 1/2min + cron 重扫的重入），扣费 `uq_debit(ref_id=generation_id)` 防重复扣；调中转前按 generation_id 查重或带请求级幂等键防重复下单（中转是否支持请求级幂等键待确认）。
- **并发计数（COUNT 为准、无独立计数器）**：并发 = `COUNT(generations WHERE user_id=? AND status IN('queued','claimed','running'))`；提交事务里判 `< users.max_concurrency` 才入队，否则报"超出并发数量"。**5 分钟超时**：cron 把 `status IN('claimed','running') 且 started_at<now()-5min` 置 `failed/provider_timeout`（释放 = 状态变终态，自动反映到 COUNT，无双减/漏减）+ 告警。**无取消逻辑**（任务不可取消）。
- **余额对账**：每日 cron 比对物化余额与 `SUM(credit_lots.remaining 未过期)`，不一致告警、以批次为准。
- **积分过期（FIFO + 幂等）**：发放即建批次 `credit_lots`（含 `expires_at`，**null=永久**）；消费 `ORDER BY expires_at ASC NULLS LAST` 扣 `remaining`（先扣最早过期、永久批次最后扣；同一事务、行锁防并发双花）；每日 cron 把 `expires_at<now() 且 remaining>0` 的批次清零 + 写 `expire` 流水（幂等键=lot_id，**永久批次跳过**），同步物化余额。
- **数据地基**：现 [asyncImageJob.ts](src/server/asyncImageJob.ts) 的 `JobRecord`（只有 status/时间/原始 response）→ 迁到 `generations` 表（§16）并补 userId/model/size/duration/failureReason 等；`events`（§16）作看板唯一事实源。
- **失败原因归一化**：中转原始文案映射成有限枚举。
- **中转故障兜底**：fetch 设 timeout、重试退避、清晰文案、后台可切**备用中转 Base URL**。
- **单日预算熔断（成本硬上限，新增·必做）**：Netlify 无全局消费帽 + 中转同步阻塞使后台函数按墙钟烧 compute、平台自动重试还会放大 → 应用层维护「当日中转调用/compute 预算」计数，超阈值即**拦生成入口**（返回"今日额度已满，请稍后"）+ 告警。这是防站长破产的唯一硬上限（§14/§15）。上线前另需**实测单图 GB-hour compute 成本**对账 0.07 积分定价确认毛利为正。

## 23. 运营进阶（后台 should / later）

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
