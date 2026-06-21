// 充值套餐契约（07 §8.3 / §8.5）。实体 schema 用 drizzle-zod 从 schema.ts 派生（保持与表对齐）。
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { packages } from "../db/schema";

// 由表派生（camelCase 列名键）。金额单笔在安全整数内，number 即可（§8.5 codec 表）。
const packageSelect = createSelectSchema(packages);

// 前台展示子集（07 §8.3）：仅 active=true、按 sort（在查询层过滤）。
export const PackageItem = packageSelect.pick({
  id: true,
  title: true,
  description: true,
  priceCash: true,
  creditsMp: true,
  validDays: true,
  redirectUrl: true,
});
export type PackageItem = z.infer<typeof PackageItem>;

export const PackagesResponse = z.object({ items: z.array(PackageItem) });
export type PackagesResponse = z.infer<typeof PackagesResponse>;
