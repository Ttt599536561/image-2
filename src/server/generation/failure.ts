// ★server-only：失败原因归一化（04 §5.8，error_code 枚举唯一权威源）。
// 中转原始文案 / HTTP 状态 → 六值有限枚举；脱敏后才回前端 / 落库（绝不泄露 Key）。
import type { ErrorCode } from "../../contracts/generate";
import { redactText } from "../../lib/redaction";

export type FailureCode = ErrorCode; // insufficient_quota|relay_5xx|provider_timeout|content_rejected|relay_unreachable|unknown

type RelayErrorLike = { name?: string; httpStatus?: number; message?: string };

export function normalizeFailure(err: unknown): {
  code: FailureCode;
  message: string;
  httpStatus?: number;
} {
  const e = (err ?? {}) as RelayErrorLike;
  const status = e.httpStatus;
  // ★ 先脱敏（把 RELAY_API_KEY 串替换掉）。
  const raw = redactText(String(e.message ?? ""), [process.env.RELAY_API_KEY ?? ""]);
  let code: FailureCode = "unknown";

  if (e.name === "AbortError" || status === 504 || /timeout|timed out/i.test(raw)) {
    code = "provider_timeout"; // 软超时 AbortError 自归一化
  } else if (e.name === "TypeError" || /fetch failed|ECONN|network/i.test(raw)) {
    code = "relay_unreachable";
  } else if (/insufficient_quota|quota|billing|欠费/i.test(raw) || status === 402) {
    code = "insufficient_quota"; // ★ 中转/上游配额不足，非用户积分不足（后者入队前 402 拦截）
  } else if (/moderation|safety|content_policy|rejected/i.test(raw) || status === 403) {
    code = "content_rejected";
  } else if ((status !== undefined && status >= 500) || status === 429) {
    code = "relay_5xx"; // 非 quota 的 429（上游限流）归 relay_5xx，不新增枚举
  }

  return { code, message: raw.slice(0, 500), httpStatus: status }; // message 已脱敏、限长
}
