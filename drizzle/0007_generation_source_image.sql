-- 对话结果图二次编辑：保留来源 images.id，但不加外键。
-- 来源图被清理后，历史 generation 仍保留 source_image_id，读取摘要返回 null。
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "source_image_id" uuid;
CREATE INDEX IF NOT EXISTS "ix_gen_source_image" ON "generations" ("source_image_id");
