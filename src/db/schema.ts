// Drizzle schema — 逐列对齐 docs/dev/02-database.md §3.2 (DDL) / §3.3 (索引)。
// 金额定死整数：积分列 *_mp = 毫积分 BIGINT；现金列 *_cash = 分 BIGINT。绝不 float/NUMERIC。
//
// 🔴 命门红线（02 §3.4 / PHASE2-PLAN §1）：
//  - 5 个「部分唯一索引」(uq_debit/uq_refund/uq_grant_signup/uq_credit_code/uq_expire_lot) 是钱的幂等键，
//    带 WHERE 谓词；drizzle-kit 推断不可靠 → 生成迁移后必须人工核对 drizzle/*.sql 里确有 WHERE。
//  - users.id 无 DB default：恒由注册 hook 写入 Better Auth 的 user.id（05 §6.2）。
//  - Better Auth 的 user/session/account/verification 不在本文件定义（其 CLI 生成、同库），见 05-auth.md。
//  - inspirations 表属阶段二 §6（后台），不在地基迁移内（09 §10.4）。

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

// ========== users（业务账号；与 Better Auth user 同 id，05 §6.2） ==========
export const users = pgTable(
  "users",
  {
    // = Better Auth user.id（注册 after-hook 写入；不设 DEFAULT、恒由 hook 传入，05 §6.2）
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    // 由 Better Auth / account 管，业务侧冗余或留空（05 §6.2）
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("user"),
    maxConcurrency: integer("max_concurrency").notNull().default(2),
    isBanned: boolean("is_banned").notNull().default(false),
    // 曾兑换过任意码 = 付费（决定保留期 7/60）
    hasPaid: boolean("has_paid").notNull().default(false),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("users_role_chk", sql`${t.role} IN ('user','admin')`),
    check("users_max_concurrency_chk", sql`${t.maxConcurrency} >= 1`),
  ],
);

// ========== credit_accounts（物化余额：缓存，权威是 lots 之和） ==========
export const creditAccounts = pgTable(
  "credit_accounts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balanceMp: bigint("balance_mp", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [check("credit_accounts_balance_chk", sql`${t.balanceMp} >= 0`)],
);

// ========== credit_lots（积分批次：FIFO + 过期） ==========
export const creditLots = pgTable(
  "credit_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // signup 注册赠送 | code 兑换 | adjust 管理员手动增额建批次（09 §10.3）
    source: text("source").notNull(),
    // source=code 时指向 redeem_codes.id（DDL 无 FK 约束，保持 plain uuid）
    codeId: uuid("code_id"),
    grantedMp: bigint("granted_mp", { mode: "number" }).notNull(),
    remainingMp: bigint("remaining_mp", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", tz), // NULL = 永久不过期
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("credit_lots_source_chk", sql`${t.source} IN ('signup','code','adjust')`),
    check("credit_lots_granted_chk", sql`${t.grantedMp} > 0`),
    check("credit_lots_remaining_chk", sql`${t.remainingMp} >= 0`),
    // FIFO 扣 + 过期扫；created_at 覆盖 FIFO 第二排序键（同到期时间按建批次先后）
    index("ix_lots_user_exp").on(t.userId, t.expiresAt, t.createdAt),
  ],
);

// ========== credit_ledger（只追加账本 + 幂等键载体） ==========
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // grant 注册赠送 | credit 兑换充值 | debit 扣费 | refund 退款 | expire 过期 | adjust 手动
    entryType: text("entry_type").notNull(),
    // 始终正数；方向由 entry_type 决定
    amountMp: bigint("amount_mp", { mode: "number" }).notNull(),
    balanceAfterMp: bigint("balance_after_mp", { mode: "number" }).notNull(),
    reason: text("reason"),
    refType: text("ref_type"), // generation | signup | code | lot | admin
    refId: text("ref_id"), // generation_id | user_id | code_id | lot_id
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "credit_ledger_entry_type_chk",
      sql`${t.entryType} IN ('grant','credit','debit','refund','expire','adjust')`,
    ),
    check("credit_ledger_amount_chk", sql`${t.amountMp} > 0`),
    // —— 5 个部分唯一索引（钱的幂等键，带 WHERE 谓词，02 §3.3）。迁移后人工核对 WHERE。——
    // 扣费：每个 generation 只能扣一次
    uniqueIndex("uq_debit").on(t.refId).where(sql`entry_type = 'debit'`),
    // 退款：每个 generation 只能退一次
    uniqueIndex("uq_refund").on(t.refId).where(sql`entry_type = 'refund'`),
    // 注册赠送：每个 user 只发一次（ref_type=signup, ref_id=user_id）
    uniqueIndex("uq_grant_signup")
      .on(t.refId)
      .where(sql`entry_type = 'grant' AND ref_type = 'signup'`),
    // 兑换充值：每个 code 只入账一次（ref_type=code, ref_id=code_id）
    uniqueIndex("uq_credit_code").on(t.refId).where(sql`entry_type = 'credit'`),
    // 过期：每个 lot 只清一次
    uniqueIndex("uq_expire_lot").on(t.refId).where(sql`entry_type = 'expire'`),
    index("ix_ledger_user_time").on(t.userId, t.createdAt.desc()),
  ],
);

// ========== packages（充值套餐） ==========
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"), // 适用场景/人群，可空，前台 2 行内
    priceCash: bigint("price_cash", { mode: "number" }).notNull(), // 分
    creditsMp: bigint("credits_mp", { mode: "number" }).notNull(), // 毫积分
    validDays: integer("valid_days"), // 兑后多少天过期；NULL = 永久
    redirectUrl: text("redirect_url"), // 第三方店铺 URL（前期可空占位）
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("packages_price_chk", sql`${t.priceCash} > 0`),
    check("packages_credits_chk", sql`${t.creditsMp} > 0`),
  ],
);

// ========== redeem_codes（兑换码） ==========
export const redeemCodes = pgTable(
  "redeem_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(), // 18 位 base32（去 0/O/1/I/L）
    // 决定积分/面值/有效期；RESTRICT 挡删有码的套餐（09 §10.6）
    packageId: uuid("package_id").references(() => packages.id, { onDelete: "restrict" }),
    creditsValueMp: bigint("credits_value_mp", { mode: "number" }).notNull(), // 冗余快照
    cashValue: bigint("cash_value", { mode: "number" }).notNull(), // 面值现金（分）
    validDays: integer("valid_days"), // 冗余快照；NULL=永久
    status: text("status").notNull().default("active"),
    batchId: uuid("batch_id"), // 生成批次
    redeemedBy: uuid("redeemed_by").references(() => users.id),
    redeemedAt: timestamp("redeemed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("redeem_codes_credits_chk", sql`${t.creditsValueMp} > 0`),
    check("redeem_codes_cash_chk", sql`${t.cashValue} >= 0`),
    check("redeem_codes_status_chk", sql`${t.status} IN ('active','redeemed','disabled')`),
    index("ix_codes_batch").on(t.batchId),
  ],
);

// ========== conversations（会话） ==========
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("ix_conv_user_upd").on(t.userId, t.updatedAt.desc())],
);

// ========== generations（生成记录 + 状态机/队列） ==========
export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    model: text("model").notNull().default("gpt-image-2"),
    size: text("size").notNull(), // auto|1024x1024|1024x1536|1536x1024|1088x1920|1920x1088
    quality: text("quality"),
    background: text("background"),
    moderation: text("moderation").notNull().default("low"),
    // ④b 图生图：参考图上传 key（uploads/<userId>/…）；NULL = 文生图。管线有图走 /images/edits multipart。
    inputImageKey: text("input_image_key"),
    status: text("status").notNull().default("queued"),
    jobId: text("job_id"), // 抢占者标识/中转 task id（可选）
    errorCode: text("error_code"), // 归一化失败枚举（04 §5.8），NULL 除非 failed
    error: text("error"), // 脱敏人读报错（可含状态码原文）
    httpStatus: integer("http_status"), // 中转 HTTP 状态码（可空）
    creditsChargedMp: bigint("credits_charged_mp", { mode: "number" }).notNull().default(0), // 成功才>0
    startedAt: timestamp("started_at", tz), // 置 running 时写
    completedAt: timestamp("completed_at", tz), // 终态时写
    durationMs: integer("duration_ms"), // completed_at - started_at
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "generations_status_chk",
      sql`${t.status} IN ('queued','claimed','running','succeeded','failed')`,
    ),
    index("ix_gen_conv").on(t.conversationId),
    index("ix_gen_user_time").on(t.userId, t.createdAt.desc()),
    // cron 扫超时/重扫；status 前导列缩小集合
    index("ix_gen_status_time").on(t.status, t.createdAt),
  ],
);

// ========== images（落地图） ==========
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id")
      .notNull()
      .unique()
      .references(() => generations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(), // R2 内部 key（不可枚举随机段）
    publicUrl: text("public_url").notNull(), // 前端只读它
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    isPublic: boolean("is_public").notNull().default(false),
    // §5.2「存入资产库」；资产库默认即用户全部图，可用此区分主动收藏
    savedToLibrary: boolean("saved_to_library").notNull().default(false),
    expiresAt: timestamp("expires_at", tz), // 保留期（免费 7/付费 60，升级顺延）
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("ix_img_user_time").on(t.userId, t.createdAt.desc()), // 资产库
    index("ix_img_expires").on(t.expiresAt), // 清理 cron
  ],
);

// ========== audit_log（管理员审计） ==========
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(), // adjust_credit|reset_pw|ban|gen_codes|disable_batch|edit_config|...
  targetType: text("target_type"), // user|code|package|inspiration|config
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  reason: text("reason"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

// ========== notifications（站内通知：image_expiring cron 自动 + announcement 后台广播，06 §7.4 / 07 §8.3 / §9） ==========
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // image_expiring | announcement（纯 text 无 CHECK，新增类型免迁移）
    payload: jsonb("payload"), // image_expiring:{imageId,expiresAt} | announcement:{title,body,link?}
    dedupeKey: text("dedupe_key").notNull(), // image_expiring:<图id> | announcement:<公告id>:<用户id>；靠它幂等
    readAt: timestamp("read_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // cron 重跑/每日不重发同一条
    uniqueIndex("uq_notif_dedupe").on(t.dedupeKey),
    // 未读列表
    index("ix_notif_user").on(t.userId, t.createdAt.desc()).where(sql`read_at IS NULL`),
  ],
);

// ========== events（append-only 事实表，看板唯一事实源） ==========
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // user_registered|image_succeeded|image_failed|code_redeemed|credit_granted|
    // credit_consumed|credit_expired|image_cleaned|credit_shortfall|balance_reconciled
    type: text("type").notNull(),
    userId: uuid("user_id"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("ix_events_type_time").on(t.type, t.createdAt)], // 看板聚合
);

// ========== app_config（全局参数 KV） ==========
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

// ========== inspirations（灵感库；阶段二 §6 后台 CRUD，09 §10.4） ==========
export const inspirations = pgTable(
  "inspirations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    coverKey: text("cover_key"), // R2 内部 key（multipart 上传时填；贴 URL 时可空）
    coverUrl: text("cover_url").notNull(), // 前端只读公有 URL（06 §7.6）
    category: text("category"), // 品类标签（单值，本期）
    prompt: text("prompt").notNull(), // 「用此提示词」一键带回（§24-10）
    summary: text("summary"), // 一行摘要
    width: integer("width"), // 封面原始宽（瀑布流按原比例预留盒、避免抖动；P3-S4，可空）
    height: integer("height"), // 封面原始高（同上，可空）
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true), // 前台只展示 active
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("ix_insp_active_sort").on(t.active, t.sort)],
);
