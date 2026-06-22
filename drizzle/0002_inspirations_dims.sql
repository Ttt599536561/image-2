-- 0002 · 灵感库封面原始宽高（P3-S4 灵感运营化）。瀑布流按原比例预留盒、避免图片加载抖动（CLS）。
-- 可空：admin 贴 URL 时可不填（前端可「从封面探测」自动回填）；缺省时画廊回退自然加载（不报错）。
-- 非钱/码、无 mp；幂等（ADD COLUMN IF NOT EXISTS）。
ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "width"  integer;
ALTER TABLE "inspirations" ADD COLUMN IF NOT EXISTS "height" integer;
