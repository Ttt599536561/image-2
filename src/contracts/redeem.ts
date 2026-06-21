// 兑换契约（07 §8.5 / §8.4）。码字母表是前后端 + 后台生成（09 §10.2）的单一真相源。
import { z } from "zod";

// 26 字母去 I/O/L (=23) + 2-9 (=8) → 共 31 个字符；可枚举性极低（31^18 ≈ 7e26）。
export const REDEEM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
// 由 REDEEM_ALPHABET 派生，18 位，排除 I/L/O 与 0/1。
export const REDEEM_CODE_RE = /^[A-HJKMNP-Z2-9]{18}$/;

export const RedeemRequest = z.object({
  code: z.string().regex(REDEEM_CODE_RE, "兑换码无效"),
});
export type RedeemRequest = z.infer<typeof RedeemRequest>;

export const RedeemResponse = z.object({
  balanceMp: z.number().int(),
  creditsValueMp: z.number().int(),
});
export type RedeemResponse = z.infer<typeof RedeemResponse>;

// 兑换错误码（07 §8.4，与 03 §4.7 对齐）。
export const REDEEM_ERROR_CODES = [
  "BAD_CODE_FORMAT", // 400 格式不符
  "CODE_NOT_FOUND", // 404 码不存在
  "CODE_USED", // 410 已被使用
  "CODE_DISABLED", // 410 已作废
  "RATE_LIMITED", // 429 尝试过多
] as const;
export type RedeemErrorCode = (typeof REDEEM_ERROR_CODES)[number];
