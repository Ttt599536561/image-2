// 账号面契约（07 §8.3 / §8.5）。改密 + 积分流水。
// 密码 ≥6 且 ≤72 字节（05 §6.4，防 bcrypt 72 字节截断）；用浏览器安全的 TextEncoder（不用 Node Buffer）。
import { z } from "zod";

export const passwordField = z
  .string()
  .min(6, "密码至少 6 位")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "密码过长（最多 72 字节）");

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: passwordField,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const LedgerItem = z.object({
  id: z.uuid(),
  entryType: z.enum(["grant", "credit", "debit", "refund", "expire", "adjust"]),
  amountMp: z.number().int(), // 单笔安全 number
  balanceAfterMp: z.number().int(),
  reason: z.string().nullable(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerItem = z.infer<typeof LedgerItem>;

export const LedgerResponse = z.object({
  items: z.array(LedgerItem),
  total: z.number().int(),
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
});
export type LedgerResponse = z.infer<typeof LedgerResponse>;
