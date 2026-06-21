// 充值套餐契约（07 §8.3 / §8.5）。
// 🔴 红线（server-only 边界）：本文件被客户端 hook（usePackages）value-import，**绝不** value-import
//   src/db/schema.ts（drizzle-zod createSelectSchema 会把整套 Drizzle schema + 运行时拖进客户端 bundle，
//   泄露内部钱账本表/约束/幂等索引名）。故手写 Zod，逐列对齐 schema.ts 的 packages（与其它契约同范式）。
import { z } from "zod";

// 前台展示子集（07 §8.3）：仅 active=true、按 sort（在查询层过滤）。列类型/可空逐列对齐 db/schema.ts packages。
export const PackageItem = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(), // text，可空
  priceCash: z.number().int(), // bigint(分)，单笔安全 number（§8.5）
  creditsMp: z.number().int(), // bigint(毫积分)
  validDays: z.number().int().nullable(), // integer，NULL=永久
  redirectUrl: z.string().nullable(), // text，可空（第三方店铺 URL）
});
export type PackageItem = z.infer<typeof PackageItem>;

export const PackagesResponse = z.object({ items: z.array(PackageItem) });
export type PackagesResponse = z.infer<typeof PackagesResponse>;
