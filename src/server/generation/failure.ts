// ★server-only：失败原因归一化（04 §5.8，error_code 枚举唯一权威源）。
// 中转原始文案 / HTTP 状态 → 六值有限枚举；脱敏后才回前端 / 落库（绝不泄露 Key）。
import type { CredentialMode, ErrorCode } from "../../contracts/generate";
import { redactText } from "../../lib/redaction";

export type FailureCode = ErrorCode; // insufficient_quota|relay_5xx|provider_timeout|content_rejected|relay_unreachable|unknown

type RelayErrorLike = { name?: string; httpStatus?: number; message?: string; failureCode?: ErrorCode };

export function normalizeFailure(
  err: unknown,
  context: { mode: CredentialMode; secrets: string[] } = {
    mode: "system",
    secrets: [process.env.RELAY_API_KEY ?? ""],
  },
): {
  code: FailureCode;
  message: string;
  httpStatus?: number;
} {
  const value = (err ?? {}) as RelayErrorLike;
  const status = value.httpStatus;
  const raw = redactText(String(value.message ?? ""), context.secrets);
  if (value.failureCode) {
    const code =
      context.mode === "system" &&
      (value.failureCode === "invalid_response" || value.failureCode === "storage_failed")
        ? "unknown"
        : value.failureCode;
    return { code, message: raw.slice(0, 500), httpStatus: status };
  }
  if (value.name === "AbortError" || status === 504 || /timeout|timed out|deadline/i.test(raw)) {
    return { code: "provider_timeout", message: "请求超时，本站未扣积分，请重试", httpStatus: status };
  }
  if (
    /moderation|safety|content_policy|rejected/i.test(raw) ||
    (status === 403 && /content|policy/i.test(raw)) ||
    (context.mode === "system" && status === 403)
  ) {
    return { code: "content_rejected", message: raw.slice(0, 500), httpStatus: status };
  }
  if (/insufficient_quota|quota|billing|欠费/i.test(raw) || status === 402) {
    return {
      code: context.mode === "custom" ? "custom_key_quota" : "insufficient_quota",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  if (context.mode === "custom" && (status === 401 || status === 403)) {
    return { code: "custom_key_invalid", message: raw.slice(0, 500), httpStatus: status };
  }
  if (status === 429) {
    return {
      code: context.mode === "custom" ? "relay_rate_limited" : "relay_5xx",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  if (status === 400 || /invalid|must use|unsupported|dimension|format/i.test(raw)) {
    return { code: "invalid_request", message: raw.slice(0, 500), httpStatus: status };
  }
  if (value.name === "TypeError" || /fetch failed|ECONN|network/i.test(raw)) {
    return { code: "relay_unreachable", message: raw.slice(0, 500), httpStatus: status };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: context.mode === "custom" ? "relay_unreachable" : "relay_5xx",
      message: raw.slice(0, 500),
      httpStatus: status,
    };
  }
  return { code: "unknown", message: raw.slice(0, 500), httpStatus: status };
}
