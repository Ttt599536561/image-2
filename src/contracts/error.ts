// 统一错误信封 + 抛出器（07 §8.1 / §8.2）。前端按 error.code 分支文案，不解析 message。
import { z } from "zod";

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// 稳定大写错误码枚举（07 §8.2 / §8.4）。前端据此分支。
export const API_ERROR_CODES = [
  "INVALID_PARAM",
  "BAD_CODE_FORMAT",
  "UNAUTHENTICATED",
  "INSUFFICIENT_CREDITS",
  "BANNED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CODE_NOT_FOUND",
  "CONCURRENCY_LIMIT",
  "EMAIL_TAKEN",
  "CODE_USED",
  "CODE_DISABLED",
  "RATE_LIMITED",
  "BUDGET_EXHAUSTED",
  "CUSTOM_KEY_REQUIRED",
  "SYSTEM_MODE_FORBIDS_CUSTOM_KEY",
  "CUSTOM_KEY_MODES_DISABLED",
  "SOURCE_IMAGE_UNAVAILABLE",
  "MAINTENANCE",
  "UPDATE_UNAVAILABLE",
  "UPDATE_CONFLICT",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 统一错误响应（服务端用；成功直接返回数据对象，无此结构）。 */
export function httpError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}
