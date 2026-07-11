# 用户生图 Key 模式与多任务生成 PRD

状态：已批准；本地实现已完成。生产 Docker rollout 状态只看
[PROGRESS.md](../docs/PROGRESS.md)。

## 目标

在不改变 system 钱链路的前提下，通过统一 `POST /api/generate` 支持 system 和
custom 两种凭据模式、多任务状态追踪、任务级加密临时凭据和五分钟权威 deadline。
不新增第二个 custom 生图端点，不新增取消能力，也不自动回退 system。

## 产品决策

| 维度 | system | custom |
|---|---|---|
| 默认与记忆 | 首次默认；浏览器按 user ID 记住上次模式 | 同上 |
| Base URL | 后台配置，env 兜底 | 固定 `https://api.tangguo.xin/v1`，客户端不可修改/提交 |
| Key | 仅服务端 | 当前浏览器 localStorage 明文，经 HTTPS 请求提交 |
| 服务端保存 | app config/env | 仅 generation-scoped AES-GCM 密文，终态立即删除 |
| 计费 | 余额校验、FIFO 成功扣费、账本 | 不查余额、不扣本站积分、不写 debit |
| 预算与并发 | system 日预算和 system in-flight 并发 | 不计 system 预算/并发，不做生成提交限流 |
| 会话交互 | 同会话已有 system in-flight 时锁 Composer | 可连续提交多个任务 |
| 图片结果 | 同一对象存储、会话、资产库与保留期 | 完全相同 |

“本站不扣积分”不代表第三方免费；custom Key 的第三方计费与退款由服务商决定。

## 请求与状态

- 新客户端显式发送 `credentialMode: "system" | "custom"`。旧请求缺 mode 且无
  Key 兼容为 system；缺 mode/system 却带 custom Key 固定 `400`。
- custom Key trim 后非空、最多 500 字符；system 请求不得携带它；客户端不得发送
  Base URL。
- 成功入队统一返回 `202 { generationId, conversationId, status, credentialMode,
  deadlineAt }`。
- `generations` 状态为 `queued -> claimed -> running -> succeeded|failed`。worker
  只在原子抢占成功后处理任务；两种模式复用同一 `callRelay`、图片存储和状态 API。
- browser 对当前会话所有非终态任务批量轮询；每个请求最多 50 IDs，`missingIds`
  不泄露任务是否存在或归属。

## 凭据、超时与安全

- generation 与 custom 凭据必须同事务创建或具等价补偿；无凭据不能返回 `202`。
- 凭据只含密文、随机 IV、认证 tag、版本和数据库时钟到期时间；不得出现在
  `generations` 普通字段、图片、events、audit、Sentry、日志或响应。
- 成功、失败和超时均立即删除凭据。孤儿 TTL 为 10 分钟，scheduler 每 5 分钟清理，
  正常调度下最迟创建后 15 分钟物理删除；失败需告警。
- system/custom 都以创建时间加 5 分钟为 deadline；relay 最迟在 deadline 前 30 秒
  中止。成功与超时只能一个终态生效，超时不扣本站积分。
- relay 边界必须脱敏实际 system/custom Key。custom 失败保持 custom 模式和本地 Key，
  不自动调用 system。
- `CUSTOM_KEY_MODES_ENABLED` 缺省关闭。关闭时为 `503` 且零写入，UI 不得静默切
  system。回滚先关入口，再用受审计脚本收口在途 custom 和清凭据；清零前不得轮换
  加密主密钥。

## 用户体验

- 顶栏 `KeyRound` 图标打开可访问模态框，system/custom 互斥单选；custom 区支持
  密码显示/隐藏、保存和清除，固定 URL 只读展示。
- 配置按登录 user ID 隔离；水合和账号切换未 ready 时不得提交，退出登录不删除该用户
  配置。
- custom 允许至少三项连续提交；每项卡片独立显示 prompt、比例、elapsed 和状态，
  任一终态不停止其他轮询。
- system 保留余额不足、并发、预算和成功扣费语义；custom 成功显示零本站扣费。
- 错误必须归一化为可操作、脱敏的稳定代码和文案，涵盖无效 Key、配额、限流、网络、
  timeout、内容拒绝、坏响应和存储失败。

## 本地验收证据

本地实现覆盖统一入口、system 回归、custom 零扣费、51+ ID 批量分片、deadline 竞态、
凭据生命周期、脱敏、移动端 Key 配置和 rollback containment。最近验证：单元测试
`188/188`、金额测试 `74/74`、类型检查、构建、秘密扫描和 Compose 配置通过。

生产验收仍需完成管理员凭据轮换、Compose migration、system dark rollout、custom
`503` 零写入、受控 custom t2i/i2i 和 rollback 演练。具体状态与命令分别见
[PROGRESS.md](../docs/PROGRESS.md) 和 [deploy.md](../docs/dev/deploy.md)。
