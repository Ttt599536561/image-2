// 灵感库契约（07 §8.3，只读，站长后台维护）。前台仅返回已上架卡。
import { z } from "zod";

export const InspirationItem = z.object({
  id: z.uuid(),
  cover: z.url(), // 公有 URL（DB cover_url；前端只读，06 §7.6）
  title: z.string(),
  summary: z.string().nullable(),
  prompt: z.string(), // 「用此提示词」一键带回（§24-10）
  category: z.string().nullable(),
});
export type InspirationItem = z.infer<typeof InspirationItem>;

export const InspirationsResponse = z.object({ items: z.array(InspirationItem) });
export type InspirationsResponse = z.infer<typeof InspirationsResponse>;
