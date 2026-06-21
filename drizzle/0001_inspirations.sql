-- 阶段二 §6 后台：灵感库表（09 §10.4）。非钱/码、无 mp；前台只展示 active。
-- 应用：node --env-file=.env --import tsx scripts/migrate-inspirations.ts（或纳入统一迁移流程）。
CREATE TABLE IF NOT EXISTS "inspirations" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"      text NOT NULL,
  "cover_key"  text,
  "cover_url"  text NOT NULL,
  "category"   text,
  "prompt"     text NOT NULL,
  "summary"    text,
  "sort"       integer NOT NULL DEFAULT 0,
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ix_insp_active_sort" ON "inspirations" ("active","sort");
