// 资产库契约（07 §8.3）。列表（日期筛选 + 分页，前端按 createdAt 分组）+ 存入 + 批量删除。
import { z } from "zod";

// range ∈ {all,today,7d,30d,custom}（§24-8），custom 配 from/to。
export const IMAGE_RANGES = ["all", "today", "7d", "30d", "custom"] as const;
export type ImageRange = (typeof IMAGE_RANGES)[number];

export const ImagesQuery = z.object({
  range: z.enum(IMAGE_RANGES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(200).optional(), // P3-S2 按提示词搜索
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});
export type ImagesQuery = z.infer<typeof ImagesQuery>;

export const ImageItem = z.object({
  id: z.uuid(),
  generationId: z.uuid(),
  prompt: z.string(),
  publicUrl: z.url(), // 前端只读它（06 §7.6）
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  savedToLibrary: z.boolean(),
});
export type ImageItem = z.infer<typeof ImageItem>;

export const ImagesResponse = z.object({
  items: z.array(ImageItem),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ImagesResponse = z.infer<typeof ImagesResponse>;

export const SaveRequest = z.object({ generationId: z.uuid() });
export type SaveRequest = z.infer<typeof SaveRequest>;
export const SaveResponse = z.object({ id: z.uuid(), savedToLibrary: z.literal(true) });
export type SaveResponse = z.infer<typeof SaveResponse>;

// 批量删除（不可恢复，同时异步删 R2，前端弹确认 §24-9）。
export const DeleteRequest = z.object({ ids: z.array(z.uuid()).min(1) });
export type DeleteRequest = z.infer<typeof DeleteRequest>;
export const DeleteResponse = z.object({ deleted: z.number().int() });
export type DeleteResponse = z.infer<typeof DeleteResponse>;
