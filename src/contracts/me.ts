// /api/me（07 §8.3 / §8.5）。含积分过期实时提示数据源 expiringSoon。
import { z } from "zod";

export const MeResponse = z.object({
  user: z.object({ id: z.uuid(), email: z.string(), role: z.string(), createdAt: z.string() }),
  balanceMp: z.number().int(), // 单笔/余额安全用 number（§8.5 codec 表）
  maxConcurrency: z.number().int(),
  // 单图价（毫积分）= app_config.price_per_image_mp 的实时值，前端展示/预校验以此为准（后台改价即时生效）。
  pricePerImageMp: z.number().int(),
  hasPaid: z.boolean(),
  // 3 天内即将过期的剩余毫积分：mp 走 string codec（SUM 聚合，避免精度风险）。来源 SQL 见 07 §8.3。
  expiringSoon: z.object({
    mp: z.string(), // string codec（与看板 SUM 同规则）
    nearestExpiresAt: z.string().nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;
