-- 0003 · 图生图（④b）：generations 加参考图上传 key 列。
-- 有值 = 图生图（管线 callRelay 走 /images/edits multipart）；NULL = 文生图（现状 /images/generations）。
-- key 形如 uploads/<userId>/<yyyy>/<mm>/<uuid>.<ext>；上传图「用后即弃」，靠孤儿清理 cron 回收。
-- 非钱/码、无 mp、可空；幂等（ADD COLUMN IF NOT EXISTS）。
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "input_image_key" text;
