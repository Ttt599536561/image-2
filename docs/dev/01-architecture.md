# 2 · 系统架构

> 组件图 + 三大流程时序（生图 / 扣费 / 兑换）。阶段一 = DB-as-queue，第三步规模化才迁独立 worker（[§15 第三步](../redesign-requirements.md)，本期不展开）。
> **2026-07-11 增补**：下方既有图展示 system-only 基线；目标模式化生图架构以 §2.7 为准，两种模式仍共用一个提交端点、一个状态机和一个中转客户端。

## 2.1 组件图

```mermaid
flowchart TB
  subgraph Client["浏览器（React Router 8 framework 模式）"]
    UI["Composer 五态 / 资产库 / 充值 / 后台\nTanStack Query v5 + tokens.css"]
  end

  subgraph Netlify["Netlify"]
    direction TB
    Loader["RR8 loader/action (SSR)\n直连 DB 读列表/余额"]
    FnSubmit["fn: generate (同步)\n入队 + 余额/并发校验"]
    FnStatus["fn: generate-status (同步)\n短轮询查 generations"]
    FnRedeem["fn: redeem (同步)\n兑换核销"]
    FnAuth["Better Auth handler\n注册/登录/会话"]
    FnAdmin["fn: admin/* (同步)\n后台 API"]
    BG["fn: generate-background (15min)\n抢占→调中转→落对象存储→扣费事务"]
    Cron["Scheduled Fns (cron)\n超时重扫/过期/清理/对账/旧预算键清理"]
  end

  subgraph Data["数据与外部"]
    Neon[("Neon Postgres\n钱·码·会话·生成·审计·事件")]
    Storage[("Supabase Storage\nS3 兼容公有 bucket")]
    Relay["中转 api.tangguo.xin\n同步阻塞·无 webhook"]
  end

  UI -->|"REST 202+短轮询"| FnSubmit
  UI --> FnStatus
  UI --> FnRedeem
  UI --> FnAuth
  UI --> FnAdmin
  UI -.->|"首屏/导航 SSR"| Loader

  FnSubmit -->|"INSERT generations(status=queued)\nFOR UPDATE 校并发/余额"| Neon
  FnSubmit -.->|"await 短触发请求\n不等待 relay/job"| BG
  FnStatus --> Neon
  FnRedeem -->|"UPDATE…RETURNING"| Neon
  FnAuth --> Neon
  FnAdmin --> Neon
  Loader --> Neon

  BG -->|"抢占 UPDATE…WHERE status='queued' RETURNING"| Neon
  BG -->|"Bearer RELAY_API_KEY"| Relay
  BG -->|"PUT 结果图"| Storage
  BG -->|"扣费事务(FOR UPDATE/FIFO)"| Neon

  Cron --> Neon
  Cron --> Storage
  UI -->|"读稳定 public_url"| Storage
```

**要点**：
- 前端**只读对象存储的稳定 `public_url`**，永不读中转临时 URL（否则历史/资产库整片裂图）。
- **job 态以 `generations` 表（Postgres）为准**，不再用 Netlify Blobs 存 job 态（Blobs 是 KV、最终一致、无原子操作）。
- 钱/码事务只碰 `credit_lots / credit_ledger / credit_accounts / redeem_codes`；Better Auth 的 `user/session/account/verification` 同库各管各事务、互不干扰。
- **解耦两层轮询**：前端 ↔ 本站 = 短轮询 `generate-status`；本站 ↔ 中转 = Background Function 内**长 await**（中转无 webhook，只能阻塞等）。

## 2.2 流程一 · 生图（提交 → 后台 → 短轮询）

```mermaid
sequenceDiagram
  autonumber
  participant U as 前端
  participant S as fn:generate (同步)
  participant DB as Neon
  participant BG as fn:generate-background
  participant R as 中转
  participant Storage as Supabase Storage

  U->>S: POST /api/generate {prompt,size,quality,background}
  S->>DB: 事务: 校并发<max && 余额≥70mp\nINSERT generations(status=queued) RETURNING id
  alt 余额不足
    S-->>U: 402 余额不足（不入队、不扣费）
  else 并发超限
    S-->>U: 409 超出并发数量
  else 通过
    S->>BG: 真后台触发(generation_id)
    S-->>U: 202 {generationId, status:queued}
  end
  loop 每 2s，上限 5min
    U->>DB: GET /api/generate-status?id= (查 generations)
    DB-->>U: status + (成功时 image.public_url / 失败时 error+code)
  end
  BG->>DB: 抢占 UPDATE…WHERE id=? AND status='queued' RETURNING (→claimed)
  Note over BG,DB: 抢不到即退（挡平台自动重试/cron 重扫的重复下单）
  BG->>DB: UPDATE status='running', started_at=now
  BG->>R: POST 生图 (Bearer RELAY_API_KEY, n=1, moderation=low)
  R-->>BG: 图(URL/base64) 或 错误
  alt 成功
    BG->>Storage: PUT 对象 → storage_key/public_url
    BG->>DB: 扣费事务(见 2.3) → status=succeeded
  else 失败/超时
    BG->>DB: status=failed + error(归一化) + 不扣费
  end
```

**图中旧 5min 基线**：现有 system-only 代码由前端计时停轮询、cron 收口。目标实现以 `deadline_at` 为权威，状态读取与 cron 共用原子 helper（[03-money.md §4.6](03-money.md) / §2.7）。

## 2.3 流程二 · 扣费（成功落图后的单事务）

> **成功才扣**。判定标准 = **图落对象存储成功 + 写库成功**。先传 Supabase Storage（事务外、结果存临时变量），再开单事务。完整可执行步骤与回滚见 [03-money.md §4.3](03-money.md)；此处给时序骨架。

```mermaid
sequenceDiagram
  autonumber
  participant BG as fn:generate-background
  participant Storage as Supabase Storage
  participant DB as Neon (Pool/WS 事务)

  BG->>Storage: PUT 结果图 (事务外)
  Storage-->>BG: storage_key, public_url
  BG->>DB: BEGIN
  DB->>DB: ① SELECT credit_lots FOR UPDATE\n   WHERE user_id=? AND remaining>0 AND 未过期\n   ORDER BY expires_at ASC NULLS LAST
  DB->>DB: ② 跨批次 FIFO 扣够 70mp（各批 remaining 不出负）
  DB->>DB: ③ INSERT images(generation_id unique)
  DB->>DB: ④ INSERT credit_ledger(debit, ref_id=generation_id)\n   命中 uq_debit 即已扣过→幂等
  DB->>DB: ⑤ UPDATE credit_accounts.balance (物化余额)
  DB->>DB: ⑥ UPDATE generations status=succeeded, completed_at, duration_ms\n   + INSERT events(image_succeeded)
  BG->>DB: COMMIT
  Note over BG,DB: 任一步失败→ROLLBACK；孤儿存储对象由 cron 异步清
```

这把「扣了图没存 / 图存了没扣 / 重复扣 / 余额负」四种错全堵死。幂等键 `uq_debit(ref_id=generation_id, WHERE entry_type='debit')`：平台重试重入到扣费步会撞唯一索引 → 该次扣费被吞、不重复扣。

## 2.4 流程三 · 兑换（单语句原子核销）

```mermaid
sequenceDiagram
  autonumber
  participant U as 前端(充值页)
  participant S as fn:redeem (同步)
  participant DB as Neon

  U->>S: POST /api/redeem {code}
  S->>S: 限流(IP/账号) + 格式校验
  S->>DB: 事务: \nUPDATE redeem_codes SET status='redeemed',redeemed_by,redeemed_at\n  WHERE code=? AND status='active' RETURNING id,credits_value,cash_value,package_id
  alt affected=0
    S-->>U: 404 不存在 / 410 已用或已作废（按当前 status 区分）
  else affected=1（同一事务继续）
    S->>DB: 按 package.valid_days 建 credit_lots(新批次,设 expires_at)
    S->>DB: INSERT credit_ledger(credit, ref_id=code_id) 幂等 uq_credit_code
    S->>DB: UPDATE credit_accounts.balance += credits_value
    S->>DB: 若该用户首次兑换→把其旧 images.expires_at 顺延到 60 天
    S->>DB: INSERT events(code_redeemed) [收入按 cash_value 面值记账]
    S-->>U: 200 {balance, creditsValue}
  end
```

单条 `UPDATE…WHERE status='active' RETURNING` 即防"一码多花/并发双击"——只有抢到那一次 `affected=1` 才入账。错误码区分见 [07-api.md §8.4](07-api.md)。

## 2.5 流程四 · 灵感投稿（投稿队列与上架表分离）

> 用户从自己的作品投稿灵感 → 落 `inspiration_submissions`(status=pending) → 后台审核 → 通过即建 `inspirations` 上架卡 + 署名、驳回填原因 → 给投稿人发站内通知。**投稿队列表与上架表 `inspirations` 物理分离**，用户端 `loadInspirations(active=true)` 零改动、永不读到 pending/rejected。**不扣积分**。完整设计/落地见 [INSPIRATION-UGC-PLAN.md](INSPIRATION-UGC-PLAN.md)。

```mermaid
sequenceDiagram
  autonumber
  participant U as 前端(灵感库·投稿弹窗)
  participant S as fn:api/inspiration-submissions (同步)
  participant DB as Neon
  participant Storage as Supabase Storage
  participant A as fn:admin/inspiration-submissions (同步)
  participant N as NotificationBell

  U->>S: POST {imageId,title,prompt,category?,summary?}
  S->>S: 限流(events 10/10min) + 待审上限(≤10)
  S->>DB: 归属校验 images.user_id=$me 取权威 key/url/宽高\n+ 同图去重(pending 或仍在架 approved)
  S->>Storage: 复制永久副本 → inspirations/submissions/<uid>/…(厂商中立 Get→Put)
  S->>DB: 事务: INSERT inspiration_submissions(status=pending) + events\n  撞 uq_insp_sub_pending_src → 400(并发去重兜底)
  S-->>U: 200 {id, status:pending}（不扣积分）
  A->>DB: GET 队列(listSubmissions 按状态筛 + countPendingSubmissions 红点)
  alt 通过
    A->>DB: 事务: FOR UPDATE + status='pending' 校验\n  → INSERT inspirations(cover_key=投稿副本 key, submitter_name=掩码昵称, submitted_by)\n  → UPDATE 投稿 approved + published_inspiration_id + writeAudit\n  → 通知 inspiration_reviewed(dedupe inspiration_reviewed:<subId>)
  else 驳回
    A->>DB: 事务: status='rejected' + review_reason + writeAudit + 通知
  end
  N->>DB: 投稿人铃铛拉到 inspiration_reviewed → 点跳 /inspiration
```

**要点**：
- **owner-scope**：服务端按 `images.user_id=$me` 取权威 `image_key/url/宽高`，绝不信客户端传来的字段。
- **副本前缀以 `inspirations/` 开头** → `deriveCoverKey` 天然接受；通过事务把 `inspirations.cover_key` 设为同一对象、复用不再复制。孤儿清理 known-set 新增 `SELECT image_key FROM inspiration_submissions WHERE status='pending'`：pending 副本受保护、approved 由 `cover_key` 保护、rejected/废弃按孤儿(>1h)回收（[10-ops-test.md](10-ops-test.md)）。
- 后台双守卫（`requireAdminPage` + `requireAdmin`）+ 通过/驳回二次确认 + 审计与状态变更同事务（审计动作 `approve_inspiration_submission` / `reject_inspiration_submission`）。

## 2.6 三步演进（本期只做第一/第二步）

| 步 | 内容 | 本期 |
|---|---|---|
| 第一步 | 修现状隐患：`generate.ts` 真后台 + `imageProxy.ts` 读 env key + 前端 5min 短轮询 | ✅ 阶段一 |
| 第二步 | 上 Neon + Supabase Storage S3 + DB-as-queue + 积分账本/批次 + 兑换码 + 后台 | ✅ 阶段二 |
| 第三步 | 规模化：独立常驻 worker + Redis/BullMQ（或 Netlify Async Workloads / Upstash QStash） | ⬜ 延后 |

> 升级路径**仍在 Netlify 内、不锁平台**：DB-as-queue 撑不住时，把"抢占消费"换成 QStash/Async Workloads 推送即可，`generations` 状态机不变。

## 2.7 模式化生图架构（2026-07-11）

```mermaid
flowchart LR
  UI["TopBar Key 弹窗 + Composer"] -->|"POST /api/generate\ncredentialMode"| G["generate 同步入口\n严格鉴权/归属校验"]
  G -->|"system"| SE["现有入队事务\n余额 + 并发 + 预算"]
  G -->|"custom"| CE["custom 入队事务\n跳过钱/预算/并发\n加密临时 Key"]
  SE --> DB[("generations")]
  CE --> DB
  CE --> CRED[("generation_credentials\n仅密文")]
  DB --> BG["generate-background\n按 generationId 抢占"]
  BG --> RESOLVE{"credential_mode"}
  RESOLVE -->|"system"| SYSKEY["app_config / RELAY env"]
  RESOLVE -->|"custom"| DECRYPT["解密本任务凭据"]
  SYSKEY --> RELAY["同一 callRelay"]
  DECRYPT --> RELAY
  RELAY -->|"t2i /images/generations\ni2i /images/edits"| STORE["对象存储"]
  STORE -->|"system"| CHARGE["现有成功扣费事务"]
  STORE -->|"custom"| FREE["幂等零扣费成功事务"]
  CHARGE --> CLEAN["终态 + 清凭据"]
  FREE --> CLEAN
  UI -->|"批量状态查询"| STATUS["owner-scoped status"]
  STATUS --> DB
```

关键边界：

- `generate` 只在严格鉴权、会话/参考图归属和请求契约通过后分流。custom 的 generation 与密文凭据必须同事务创建，或失败时有等价补偿；没有凭据不得返回 202。
- Background 只接 `generationId`，claim 后从 DB 读取 mode/deadline。system 解析全局配置，custom 只解密当前 generation 的 Key；Base URL 始终由服务端决定。
- `callRelay` 继续统一构造、超时、解析与错误脱敏；只有凭据来源不同。失败不跨模式回退。
- 两种模式共享图片、会话、资产、存储和状态表；成功终态按计费事务分流。custom 不触碰任何账户/批次/账本行。
- 每个 generation 在创建时写 5 分钟 `deadline_at`。上游调用最迟 `deadline_at - 30s` 中止，状态读与 cron 均可用状态谓词原子收口超时。
