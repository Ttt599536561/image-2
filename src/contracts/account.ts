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

// #8 账号页：积分批次（含有效期）。source 与 credit_lots.source 同枚举。
export const LotItem = z.object({
  id: z.uuid(),
  source: z.enum(["signup", "code", "adjust"]),
  grantedMp: z.number().int(),
  remainingMp: z.number().int(),
  expiresAt: z.string().nullable(), // NULL=永久
  createdAt: z.string(),
});
export type LotItem = z.infer<typeof LotItem>;

export const LotsResponse = z.object({
  items: z.array(LotItem),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type LotsResponse = z.infer<typeof LotsResponse>;

// #8 账号页：兑换记录（credit_ledger 中 entry_type='credit'+ref_type='code'，LEFT JOIN redeem_codes 取码/面值/有效期）。
export const RedemptionItem = z.object({
  id: z.uuid(),
  amountMp: z.number().int(),
  code: z.string().nullable(), // 已脱敏（XXXX…XXXX）
  cashValue: z.number().int().nullable(), // 面值（分）
  validDays: z.number().int().nullable(),
  createdAt: z.string(),
});
export type RedemptionItem = z.infer<typeof RedemptionItem>;

export const RedemptionsResponse = z.object({
  items: z.array(RedemptionItem),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type RedemptionsResponse = z.infer<typeof RedemptionsResponse>;
