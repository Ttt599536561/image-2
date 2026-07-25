-- 0009 · 侧边栏项目分组（F-074）：projects 表 + conversations 归属/排序列 + 存量会话迁移。
-- 非钱/码、无 mp；幂等（IF NOT EXISTS / NOT EXISTS / IS NULL 守卫），重跑无副作用。
-- 排序语义：sort_order 升序为显示顺序；同一组内唯一性由应用层「整组重排」保证。
CREATE TABLE IF NOT EXISTS "projects" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"       text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- 每用户至多一个默认项目（部分唯一索引，WHERE 谓词不可丢）：懒创建并发 + 存量迁移的幂等键。
CREATE UNIQUE INDEX IF NOT EXISTS "uq_projects_user_default" ON "projects" ("user_id") WHERE "is_default";
CREATE INDEX IF NOT EXISTS "ix_projects_user_sort" ON "projects" ("user_id","sort_order");

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "ix_conv_project_sort" ON "conversations" ("project_id","sort_order");

-- 存量迁移①：为每个「有会话但还没有默认项目」的用户创建默认项目（重跑时 NOT EXISTS 全假 → 零写入）。
WITH ins AS (
  INSERT INTO "projects" ("user_id","name","is_default","sort_order")
  SELECT DISTINCT c."user_id", '默认项目', true, 0
  FROM "conversations" c
  WHERE NOT EXISTS (
    SELECT 1 FROM "projects" p WHERE p."user_id" = c."user_id" AND p."is_default"
  )
  RETURNING "id","user_id"
)
UPDATE "conversations" c
SET "project_id" = ins."id"
FROM ins
WHERE c."user_id" = ins."user_id" AND c."project_id" IS NULL;

-- 存量迁移②：项目内会话按最近更新倒序编号（0 起），与侧栏默认展示顺序一致。
WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "updated_at" DESC) - 1 AS rn
  FROM "conversations"
  WHERE "project_id" IS NOT NULL
)
UPDATE "conversations" c
SET "sort_order" = numbered.rn
FROM numbered
WHERE c."id" = numbered."id";
