-- 0008 · 首页画廊（landing_gallery_items）：管理后台手动配置未登录 /welcome 落地页展示的图片。
-- 与灵感库（inspirations）解耦：门面页读本表 active 卡；本表无 active 卡时 /welcome 回退灵感库 active → 种子。
-- 非钱/码、无 mp；幂等（IF NOT EXISTS）。
-- image_key 用途对齐 inspirations.cover_key：上传对象（landing/… 前缀）由孤儿清理 known-set 保护，
-- 删/换后不再命中 → 自动按孤儿(>1h)回收；贴外链时 image_key 为 NULL。
CREATE TABLE IF NOT EXISTS "landing_gallery_items" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"      text NOT NULL,
  "image_key"  text,
  "image_url"  text NOT NULL,
  "category"   text,
  "prompt"     text NOT NULL DEFAULT '',
  "summary"    text,
  "width"      integer,
  "height"     integer,
  "sort"       integer NOT NULL DEFAULT 0,
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ix_landing_gallery_active_sort" ON "landing_gallery_items" ("active","sort");
