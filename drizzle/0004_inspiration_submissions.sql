-- 0004：灵感库用户投稿与审核（规格 §13.1 / dev INSPIRATION-UGC-PLAN）。
-- 新表 inspiration_submissions（投稿队列，与上架表 inspirations 分离）+ inspirations 加署名两列。
-- 幂等（IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）；非钱表，无部分唯一索引。

CREATE TABLE IF NOT EXISTS "inspiration_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "source_image_id" uuid,
  "image_key" text NOT NULL,
  "image_url" text NOT NULL,
  "width" integer,
  "height" integer,
  "title" text NOT NULL,
  "prompt" text NOT NULL,
  "category" text,
  "summary" text,
  "status" text NOT NULL DEFAULT 'pending',
  "review_reason" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamptz,
  "published_inspiration_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "insp_sub_status_chk" CHECK ("status" IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS "ix_insp_sub_status_time" ON "inspiration_submissions" ("status","created_at");
CREATE INDEX IF NOT EXISTS "ix_insp_sub_user_time" ON "inspiration_submissions" ("user_id","created_at" DESC);
-- 同图去重的并发兜底（审查 confirmed#1）：一张源图同时只能有一条 pending 投稿。
-- 仅约束 pending（不含 approved）→ 即便日后上架卡被删，旧 approved 行也不会卡住重投（审查 confirmed#3 由应用层 dup-check 放行）。
CREATE UNIQUE INDEX IF NOT EXISTS "uq_insp_sub_pending_src" ON "inspiration_submissions" ("user_id","source_image_id")
  WHERE status = 'pending' AND source_image_id IS NOT NULL;

-- 外键（与 schema.ts .references(() => users.id, { onDelete: 'cascade' }) 对齐；审查 confirmed#2 修漂移）。
-- 幂等：仅当约束不存在时加（手写迁移、CREATE TABLE IF NOT EXISTS 不会补 FK）。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspiration_submissions_user_id_users_id_fk') THEN
    ALTER TABLE "inspiration_submissions"
      ADD CONSTRAINT "inspiration_submissions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- 上架卡署名（NULL = 站长自建、不显署名；用户投稿通过时写入）。
ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "submitted_by" uuid;
ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "submitter_name" text;
