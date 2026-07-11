# 3 · 数据库设计

> Neon Postgres。完整 DDL + 索引 + 部分唯一索引 + Drizzle 映射 + 迁移策略。
> **金额定死整数**：积分列 `*_mp` = 毫积分 BIGINT；现金列 `*_cash` = 分 BIGINT。绝不用 float/NUMERIC。
> 表清单与字段语义源自规格 [§16](../redesign-requirements.md)；本章把它落成可建库的 SQL。

## 3.1 表总览

| 表 | 归属 | 作用 |
|---|---|---|
| `users` | 业务（与 Better Auth user 对齐，见 [05-auth.md](05-auth.md)） | 账号 + role + 并发上限 |
| `credit_accounts` | 钱 | 物化余额（缓存，权威是 lots 之和） |
| `credit_lots` | 钱 | 积分批次（remaining + expires_at），支撑 FIFO 与过期 |
| `credit_ledger` | 钱 | 只追加账本（审计 + 幂等键载体） |
| `packages` | 钱 | 充值套餐（后台 CRUD） |
| `redeem_codes` | 钱 | 兑换码 |
| `conversations` | 内容 | 会话（ChatGPT 式线程） |
| `generations` | 内容/队列 | 生成记录 **+ 状态机（DB-as-queue）** |
| `images` | 内容 | 落地图（对象存储 key + public_url + 保留期） |
| `audit_log` | 后台 | 管理员敏感操作留痕 |
| `notifications` | 内容/提醒 | 站内通知：图片到期、后台公告、灵感审核结果；积分到期走 `/api/me` 实时字段 |
| `inspiration_submissions` | 内容/UGC | 灵感库用户投稿与审核队列（与上架表 `inspirations` 分离，详见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)） |
| `events` | 看板 | append-only 事实表，看板全从它聚合 |
| `app_config` | 配置 | 全局参数（[00 §1.5](00-overview.md)） |
| `user/session/account/verification` | 鉴权 | Better Auth 管理，见 [05-auth.md](05-auth.md) |

## 3.2 完整 DDL

> 下面是**权威建库 SQL**。Drizzle schema（§3.4）须与之逐列对齐；**部分唯一索引（带 `WHERE` 谓词）drizzle-kit 可能推断不全，以本节 SQL 为准、手写校对**。`gen_random_uuid()` 需 `pgcrypto`（Neon 默认可用）。

```sql
-- ========== 枚举（用 text + CHECK，便于演进；也可用原生 enum） ==========
-- entry_type: grant 注册赠送 | credit 兑换充值 | debit 扣费 | refund 退款 | expire 过期 | adjust 手动
-- gen_status: queued | claimed | running | succeeded | failed
-- code_status: active | redeemed | disabled
-- lot_source: signup | code | adjust
-- gen_error_code：system 继续 §5.8 既有语义；custom 使用 07-api.md §8.7 十值；读取接受并集

-- ========== users（业务账号） ==========
CREATE TABLE users (
  id              uuid PRIMARY KEY,               -- = Better Auth user.id（注册 after-hook 写入；Better Auth 配 UUID 生成，见 05-auth.md §6.2）；不设 DEFAULT、恒由 hook 传入
  email           text NOT NULL UNIQUE,
  password_hash   text,                       -- 由 Better Auth/account 管，业务侧可冗余或留空（见 05-auth）
  role            text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  max_concurrency int  NOT NULL DEFAULT 2 CHECK (max_concurrency >= 1),
  is_banned       boolean NOT NULL DEFAULT false,
  has_paid        boolean NOT NULL DEFAULT false,   -- 曾兑换过任意码=付费（决定保留期 7/60）
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ========== credit_accounts（物化余额） ==========
CREATE TABLE credit_accounts (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_mp  bigint NOT NULL DEFAULT 0 CHECK (balance_mp >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ========== credit_lots（积分批次：FIFO + 过期） ==========
CREATE TABLE credit_lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('signup','code','adjust')),  -- adjust=管理员手动增额建批次（见 09-admin.md §10.3）
  code_id       uuid,                          -- source=code 时指向 redeem_codes.id
  granted_mp    bigint NOT NULL CHECK (granted_mp > 0),
  remaining_mp  bigint NOT NULL CHECK (remaining_mp >= 0),
  expires_at    timestamptz,                   -- NULL = 永久不过期
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ========== credit_ledger（只追加账本 + 幂等键载体） ==========
CREATE TABLE credit_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type      text NOT NULL CHECK (entry_type IN ('grant','credit','debit','refund','expire','adjust')),
  amount_mp       bigint NOT NULL CHECK (amount_mp > 0),  -- 始终正数；方向由 entry_type 决定
  balance_after_mp bigint NOT NULL,
  reason          text,
  ref_type        text,                         -- generation | signup | code | lot | admin
  ref_id          text,                         -- generation_id | user_id | code_id | lot_id
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ========== packages（充值套餐） ==========
CREATE TABLE packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text,                            -- 适用场景/人群，可空，前台 2 行内展示
  price_cash   bigint NOT NULL CHECK (price_cash > 0),  -- 分
  credits_mp   bigint NOT NULL CHECK (credits_mp > 0),  -- 毫积分
  valid_days   int,                             -- 兑后多少天过期；NULL = 永久
  redirect_url text,                            -- 第三方店铺 URL（前期可空占位）
  sort         int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ========== redeem_codes（兑换码） ==========
CREATE TABLE redeem_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,           -- 18 位 base32（去 0/O/1/I/l）
  package_id    uuid REFERENCES packages(id) ON DELETE RESTRICT,   -- 决定积分/面值/有效期；RESTRICT 挡删有码的套餐（与 09 §10.6 一致；PG 缺省 NO ACTION，显式 RESTRICT 更稳）
  credits_value_mp bigint NOT NULL CHECK (credits_value_mp > 0),  -- 冗余快照（防套餐改动影响已发码）
  cash_value    bigint NOT NULL CHECK (cash_value >= 0),          -- 面值现金（分），按面值记收入
  valid_days    int,                            -- 冗余快照；NULL=永久
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','redeemed','disabled')),
  batch_id      uuid,                           -- 生成批次
  redeemed_by   uuid REFERENCES users(id),
  redeemed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ========== conversations（会话） ==========
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',         -- 取首条提示词，单行≤20 字超 …（前端截）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ========== generations（生成记录 + 状态机/队列） ==========
CREATE TABLE generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt          text NOT NULL,
  model           text NOT NULL DEFAULT 'gpt-image-2',
  size            text NOT NULL,                 -- auto|1024x1024|1024x1536|1536x1024|1088x1920|1920x1088
  quality         text,
  background      text,
  moderation      text NOT NULL DEFAULT 'low',
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','claimed','running','succeeded','failed')),
  job_id          text,                          -- 抢占者标识/中转 task id（可选）
  error_code      text,                          -- 归一化失败枚举（见 04-generation-pipeline.md §5.8），NULL 除非 failed；看板/列表按它 GROUP BY
  error           text,                          -- 脱敏人读报错（可含状态码原文，如「504 中转网关超时」），失败行后台直显
  http_status     int,                           -- 中转 HTTP 状态码（可空）
  credits_charged_mp bigint NOT NULL DEFAULT 0,  -- 成功才>0
  started_at      timestamptz,                   -- 置 running 时写
  completed_at    timestamptz,                   -- 终态时写
  duration_ms     int,                           -- completed_at - started_at
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ========== images（落地图） ==========
CREATE TABLE images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL UNIQUE REFERENCES generations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key   text NOT NULL,                   -- 对象存储内部 key（不可枚举随机段）
  public_url    text NOT NULL,                   -- 前端只读它
  content_type  text,
  width         int,
  height        int,
  size_bytes    bigint,
  is_public     boolean NOT NULL DEFAULT false,
  saved_to_library boolean NOT NULL DEFAULT false,  -- §5.2「存入资产库」；资产库默认即用户全部图，可用此区分主动收藏
  expires_at    timestamptz,                     -- 保留期（免费 7/付费 60，升级顺延）
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ========== audit_log（管理员审计） ==========
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES users(id),
  action       text NOT NULL,                    -- adjust_credit|reset_pw|ban|gen_codes|disable_batch|edit_config|...
  target_type  text,                             -- user|code|package|inspiration|config
  target_id    text,
  before       jsonb,
  after        jsonb,
  ip           text,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ========== notifications（图片到期、后台公告、灵感审核结果；积分到期走 /api/me 实时字段） ==========
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,                   -- image_expiring（目前唯一）
  payload     jsonb,                            -- {imageId, expiresAt}
  dedupe_key  text NOT NULL,                    -- image_expiring:<图id>；cron 每日重跑靠它幂等
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ========== inspiration_submissions（灵感库 UGC 投稿与审核；与上架表 inspirations 分离，保证用户端 loadInspirations(active=true) 零改动、不泄露 pending/rejected。详见 INSPIRATION-UGC-PLAN.md） ==========
CREATE TABLE inspiration_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 投稿人；删号级联清投稿
  source_image_id  uuid,                            -- 来源作品 images.id（可空；仅去重/追溯用，权威字段服务端另取）
  image_key        text NOT NULL,                   -- 永久副本对象存储 key（inspirations/submissions/<uid>/<yyyy>/<mm>/<uuid>.<ext>）
  image_url        text NOT NULL,                   -- 副本公有 URL
  width            int,
  height           int,
  title            text NOT NULL,
  prompt           text NOT NULL,
  category         text,
  summary          text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  review_reason    text,                            -- 驳回原因（rejected 时填）
  reviewed_by      uuid,                            -- 审核管理员 id
  reviewed_at      timestamptz,
  published_inspiration_id uuid,                     -- 通过后建出的 inspirations 卡 id
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ========== inspirations 加两列（上架表本体定义在历史迁移；0004 仅 ALTER 补列） ==========
-- submitted_by   uuid  投稿人 id（仅审计/追溯，不下发客户端）
-- submitter_name text  通过时冻结的掩码昵称（如 qk***；NULL=站长自建、不显署名）

-- ========== events（append-only 事实表，看板唯一事实源） ==========
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL,   -- user_registered|image_succeeded|image_failed|code_redeemed|
                              -- credit_granted|credit_consumed|credit_expired|image_cleaned
  user_id    uuid,
  payload    jsonb,           -- image_failed 带 reason; code_redeemed 带 cash_value 面值；image_* 带 duration_ms
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ========== app_config（全局参数 KV） ==========
CREATE TABLE app_config (
  key        text PRIMARY KEY,
  value_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## 3.3 索引（含部分唯一索引）

```sql
-- ---------- 幂等：部分唯一索引（合法 Postgres 写法；约束里不能写谓词，故用 INDEX + WHERE） ----------
-- 扣费：每个 generation 只能扣一次
CREATE UNIQUE INDEX uq_debit        ON credit_ledger(ref_id) WHERE entry_type='debit';
-- 退款：每个 generation 只能退一次
CREATE UNIQUE INDEX uq_refund       ON credit_ledger(ref_id) WHERE entry_type='refund';
-- 注册赠送：每个 user 只发一次（ref_type=signup, ref_id=user_id）
CREATE UNIQUE INDEX uq_grant_signup ON credit_ledger(ref_id) WHERE entry_type='grant' AND ref_type='signup';
-- 兑换充值：每个 code 只入账一次（ref_type=code, ref_id=code_id）
CREATE UNIQUE INDEX uq_credit_code  ON credit_ledger(ref_id) WHERE entry_type='credit';
-- 过期：每个 lot 只清一次
CREATE UNIQUE INDEX uq_expire_lot   ON credit_ledger(ref_id) WHERE entry_type='expire';
-- 灵感投稿：同一用户对同一来源图只能有一条待审记录（同图并发去重兜底，仅约束 pending）
CREATE UNIQUE INDEX uq_insp_sub_pending_src ON inspiration_submissions(user_id, source_image_id)
  WHERE status='pending' AND source_image_id IS NOT NULL;

-- ---------- 二级索引（高频查询防全表扫） ----------
CREATE INDEX ix_gen_conv        ON generations(conversation_id);
CREATE INDEX ix_gen_user_time   ON generations(user_id, created_at DESC);
CREATE INDEX ix_gen_status_time ON generations(status, created_at);        -- cron 扫超时/重扫；靠 status 前导列缩小集合、时间逐行过滤，进行中行极少足够
CREATE INDEX ix_img_user_time   ON images(user_id, created_at DESC);       -- 资产库
CREATE INDEX ix_img_expires     ON images(expires_at);                     -- 清理 cron
CREATE INDEX ix_lots_user_exp   ON credit_lots(user_id, expires_at, created_at);  -- FIFO 扣 + 过期扫；created_at 覆盖 FIFO 第二排序键（同到期时间按建批次先后）
CREATE INDEX ix_ledger_user_time ON credit_ledger(user_id, created_at DESC);
CREATE INDEX ix_codes_batch     ON redeem_codes(batch_id);
CREATE INDEX ix_events_type_time ON events(type, created_at);              -- 看板聚合
CREATE INDEX ix_conv_user_upd   ON conversations(user_id, updated_at DESC);-- 「最近」列表
CREATE UNIQUE INDEX uq_notif_dedupe ON notifications(dedupe_key);                                -- cron 重跑/每日不重发同一条
CREATE INDEX ix_notif_user ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;     -- 未读列表
CREATE INDEX ix_insp_sub_status_time ON inspiration_submissions(status, created_at);             -- 后台队列按状态筛 + 待审计数
CREATE INDEX ix_insp_sub_user_time   ON inspiration_submissions(user_id, created_at DESC);       -- 用户「我的投稿」列表
```

**并发计数无独立计数列**——system 并发 = `COUNT(*) FROM generations WHERE user_id=? AND credential_mode='system' AND status IN('queued','claimed','running')`。custom 可另做运维计数但不占 `max_concurrency`；任务进终态自动移除。

## 3.4 Drizzle 映射要点

- schema 放 `src/db/schema.ts`，**逐列对齐 §3.2 的 SQL**（类型、默认、CHECK 用 Drizzle 的 `check()`）。
- 毫积分/分列用 `bigint('x_mp', { mode: 'number' })`——**单笔金额在安全整数内**（0.07=70、最大套餐几十积分=几万 mp，远 < `2^53`），单笔用 `number` 安全；**看板 `SUM()` 聚合可能超界 → 用 `mode:'bigint'` 或 HTTP 查询拿 string codec 再换算**（见 [10-ops-test.md §11.4](10-ops-test.md)）。
- **部分唯一索引 drizzle-kit 推断不可靠**：在 schema 里用 `uniqueIndex().on(...).where(sql\`entry_type='debit'\`)` 声明，但**生成迁移后人工核对** `drizzle/*.sql` 里确有 `WHERE` 谓词；缺了就手写补一条迁移。这是钱的命门，不能信自动推断。
- Better Auth 的 `user/session/account/verification` 表由其 CLI/适配器生成（[05-auth.md](05-auth.md)），**不在 `schema.ts` 重复定义**，但放同库。业务 `users` 与 Better Auth `user` 的对齐策略见 05 章：**二者同 `id`（均为 UUID 字符串）**——业务 `users.id` 不设 DB 默认值、恒由注册 hook 写入 Better Auth 的 `user.id`（Better Auth 配 UUID 生成，[05-auth.md §6.2](05-auth.md)）。

## 3.5 迁移策略

- **工具**：`drizzle-kit generate`（按 schema diff 出 SQL）→ 审阅 → `drizzle-kit migrate`（或 `psql` 应用）。迁移文件入库 `drizzle/`。
- **顺序**：`pgcrypto` → 业务表（§3.2）→ 索引（§3.3）→ Better Auth 表（其 CLI）→ 种子（admin 账号、默认 packages、`app_config` 默认值）。
- **环境**：开发用 **Neon 分支库**（每个 PR 一条分支，钱链路测试对真 Postgres 跑，见 [10-ops-test.md](10-ops-test.md)）；生产单独分支。
- **零停机改列**：扩列/加索引用 `IF NOT EXISTS`、加列给默认值、`CREATE INDEX CONCURRENTLY`（Neon 支持）。**改钱相关列前先备份 + 对账脚本验平**。
- **0004（灵感库 UGC）**：`drizzle/0004_inspiration_submissions.sql` 建 `inspiration_submissions` 表 + 三索引（含部分唯一索引 `uq_insp_sub_pending_src`）+ `ALTER TABLE inspirations ADD COLUMN submitted_by / submitter_name`。落地细节见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)。
- **种子数据**：
  - admin：`role='admin'` 的初始账号（密码走 Better Auth 注册流程，再手改 role）。
  - packages：`¥9.9→10 积分`（`price_cash=990, credits_mp=10000`）、`¥29.9→32 积分`（`2990, 32000`），`valid_days` 由站长定。
  - `app_config`：单张 70 / 赠送 140 / 赠送有效期 30 / 免费 7 / 付费 60 / 默认并发 2 / 预算阈值。

## 3.6 金额换算速查

| 概念 | 单位 | 示例 |
|---|---|---|
| 1 积分 | 1000 mp | — |
| 单张扣费 0.07 积分 | **70 mp** | `credits_charged_mp=70` |
| 注册赠送 0.14 积分 | **140 mp** | signup lot `granted_mp=140` |
| ¥9.9 套餐 | `price_cash=990`，`credits_mp=10000`（10 积分） | 收入按 `cash_value=990` 记 |
| ¥29.9 套餐 | `price_cash=2990`，`credits_mp=32000`（32 积分） | — |

> 展示层才转小数（`mp/1000`）；DB/计算层一律整数 mp。

## 3.7 Key 模式与 deadline 迁移（目标迁移 `0005`）

在不改变存量 system 语义的前提下扩展：

```sql
ALTER TABLE generations
  ADD COLUMN credential_mode text NOT NULL DEFAULT 'system',
  ADD CONSTRAINT generations_credential_mode_ck
    CHECK (credential_mode IN ('system','custom'));

ALTER TABLE generations ADD COLUMN deadline_at timestamptz;

CREATE TABLE generation_credentials (
  generation_id uuid PRIMARY KEY
    REFERENCES generations(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_generation_credentials_expires
  ON generation_credentials(expires_at);
```

迁移与约束：

- 文件号使用当前序列的下一号 `drizzle/0005_user_generation_credentials.sql`；先审查仓库实际 migration journal，若编号已占用则顺延但不要覆盖。
- `credential_mode` 存量行默认 `system`。`deadline_at` 分阶段加：部署时先可空；终态存量行回填 `created_at + interval '5 minutes'`，极少数仍在途存量行在排空队列后同样回填，或显式给 `now()+5min` 的迁移宽限；然后设 `NOT NULL`。所有新 enqueue 必须直接写创建时刻 + 5 分钟。
- `generation_credentials` 只允许 custom 行。应用层在插入前验证 mode；测试加 DB 触发器并非必需，但必须有跨用户/跨 mode 负例。
- 表中只能出现 base64/等价编码的 AES-GCM 密文材料；**禁止** plaintext Key、Base URL、用户长期配置、可还原主密钥或错误原文。
- custom generation + credential 原子创建。成功、失败、超时均立即删除凭据；凭据 INSERT 用数据库 `now()+interval '10 minutes'`，生产读取/cleanup 用数据库 `now()` 判断，cleanup 每 5 分钟执行，正常调度下物理残留最迟 15 分钟，失败必须告警。
- `generations.deadline_at` 增加 in-flight 扫描索引，建议 `CREATE INDEX ix_gen_inflight_deadline ON generations(deadline_at) WHERE status IN ('queued','claimed','running')`。
- `generations.error_code` 继续使用可演进的 `text` 列，不新增封闭 CHECK：system 新任务保留现有 `insufficient_quota` / `relay_5xx` 等语义；custom 新任务写 [07 §8.7](07-api.md) 的十值集合；读取接受两组并集。
