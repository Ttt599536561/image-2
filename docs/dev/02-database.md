# 3 · 数据库设计

生产默认是 Compose 内的 PostgreSQL 17。权威 schema 在 `src/db/schema.ts`，权威迁移在 `drizzle/*.sql`；本文只记录运行时选择和不能破坏的数据约束。

金额统一使用整数：积分列 `*_mp` 为毫积分 `BIGINT`，现金列 `*_cash` 为分 `BIGINT`，禁止 float/NUMERIC。

## 3.1 连接驱动

| 场景 | 开关 | 行为 |
|---|---|---|
| 单机自托管 | `DATABASE_DRIVER=pg` | `DATABASE_URL` 与 `DATABASE_URL_UNPOOLED` 分别建立可复用的标准 `pg` pool |
| 可选托管 | 未选择 `pg` | 保留 Neon HTTP 查询与 Neon transaction pool |

安装器生成的两个 URL 都指向 Compose 私网 `postgres:5432`；宿主机不发布 `5432`。

- `getSql()`：只读聚合和单语句原子操作。
- `getPool()`：`BEGIN/COMMIT/ROLLBACK`、`FOR UPDATE`、FIFO 扣费、兑换、退款和调账。
- `closeDbPools()`：web/worker/scheduler 退出时关闭进程内连接池。

禁止把多语句读改写拆到 `getSql()`；驱动变化不能改变事务和锁语义。

## 3.2 表总览

| 表 | 作用 |
|---|---|
| `user/session/account/verification` | Better Auth 账号、会话和密码 |
| `users` | 业务角色、封禁、并发和付费状态；ID 与 Better Auth user 对齐 |
| `credit_accounts` | 物化余额缓存 |
| `credit_lots` | 可过期积分批次，FIFO 扣减 |
| `credit_ledger` | 只追加账本与幂等记录 |
| `packages/redeem_codes` | 套餐和兑换码 |
| `conversations` | 用户会话 |
| `generations` | 生成队列、deadline 和终态真相源 |
| `generation_credentials` | custom 任务级 AES-GCM 密文，终态删除 |
| `images` | 媒体 key、相对 public URL、保留期 |
| `inspirations/inspiration_submissions` | 灵感内容与投稿审核 |
| `notifications` | 站内通知 |
| `audit_log/events` | 管理审计与只追加业务事实 |
| `app_config` | 全局业务参数 |

## 3.3 金额与幂等约束

- `credit_lots.remaining_mp` 之和是余额权威值，`credit_accounts.balance_mp` 是需要对账的缓存。
- FIFO 顺序为最早到期、最早创建；永久批次最后扣。
- `credit_ledger` 的 debit、refund、signup grant、code credit 和 lot expire 使用部分唯一索引阻止重复入账。
- system 任务只有图片已写入存储且成功事务提交后才扣费；失败和超时不进入扣费事务。
- custom 任务写 `credits_charged_mp=0`，不能触碰账户、批次、账本、系统预算或 system 并发。
- 同一 `generation_id` 重试不能生成第二条有效图片记录或重复扣费。

详细事务步骤见 [03-money.md](03-money.md)。

## 3.4 队列与 deadline

`generations` 状态为 `queued -> claimed -> running -> succeeded/failed`。Worker 用带状态谓词的 `UPDATE ... RETURNING` 原子领取；system 并发只统计自己的在途任务。

新任务创建时写 `deadline_at=created_at+5min`。状态读取和 scheduler 共用原子超时收口；只有命中在途状态的一方能写 `provider_timeout`。`generation_credentials` 只允许 custom 密文，数据库时钟决定过期，正常终态立即删除，scheduler 负责兜底清理。

对话结果图编辑使用 `generations.source_image_id` 保存来源 `images.id`。该列可空且只有普通索引，不加外键：来源图片清理后历史 generation 仍保留 ID，公开摘要变为 `null`。入队事务和 worker 都按当前 user、来源成功状态重新校验；客户端不接触 `images.storage_key`。

## 3.5 迁移

迁移顺序由文件名固定：

| 文件 | 内容 |
|---|---|
| `0000_phase2_foundation.sql` | 核心业务表、外键和关键索引 |
| `0001` - `0004` | 灵感、尺寸、图生图 key 和投稿 |
| `0005_user_generation_credentials.sql` | system/custom mode、deadline 和临时凭据 |
| `0006_better_auth.sql` | Better Auth 四表及 admin 字段 |
| `0007_generation_source_image.sql` | generation 可空来源图片 ID 与查询索引 |

安装和升级只通过 `deploy/install.sh` 应用受控迁移。修改 schema 时先生成/手写迁移，再审查 SQL；金额部分唯一索引、外键和状态谓词必须人工核对。生产改金额结构前先运行备份和余额对账。

开发或 CI 的真库测试使用一次性本地 PostgreSQL。Neon 分支可用于显式选择的托管场景，但不再是默认开发或生产前提。

## 3.6 单位速查

| 概念 | 数据库值 |
|---|---|
| 1 积分 | `1000 mp` |
| 单张 0.07 积分 | `70 mp` |
| 注册赠送 0.14 积分 | `140 mp` |
| ¥9.9 | `990 cash` |

只在展示层把 mp 除以 1000；数据库和计算层始终使用整数。
