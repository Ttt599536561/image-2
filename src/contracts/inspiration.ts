// 灵感库契约（07 §8.3，只读，站长后台维护）。前台仅返回已上架卡。
import { z } from "zod";

// 前台品类 Tab（"全部" 为筛选项，非分类值）。前后端单一真相源（页面 Tab + 服务端种子共用）。
export const INSPIRATION_CATEGORIES = ["全部", "海报", "写实", "风景", "人像", "国风"] as const;

export const InspirationItem = z.object({
  id: z.uuid(),
  // 公有 URL（DB cover_url；前端只读，06 §7.6）。§6 建表前由服务端种子供给，封面可为占位 data URL，
  // 故用 string（http public_url 与 data URL 皆合法封面）。
  cover: z.string().min(1),
  title: z.string(),
  summary: z.string().nullable(),
  prompt: z.string(), // 「用此提示词」一键带回（§24-10）
  category: z.string().nullable(),
  // 封面原始宽高（瀑布流按原比例不裁切；§13）。解析不到时可空。
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type InspirationItem = z.infer<typeof InspirationItem>;

export const InspirationsResponse = z.object({ items: z.array(InspirationItem) });
export type InspirationsResponse = z.infer<typeof InspirationsResponse>;
