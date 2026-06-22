// 客户端 fetch 封装（TanStack Query queryFn/mutationFn 用；07 §8.1 统一错误信封）。
// 非 2xx → 解析错误信封抛 ApiError（前端按 .code 分支文案，不解析 message）；2xx → 可选 Zod 校验。
// 红线：只走同源 cookie 会话（credentials:'same-origin'），绝不带 Bearer/Key。
import type { z } from "zod";
import { ErrorBody } from "../contracts/error";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function throwFromResponse(res: Response): Promise<never> {
  let code = "INTERNAL";
  let message = "服务异常，请重试";
  let details: Record<string, unknown> | undefined;
  try {
    const body = await res.json();
    const parsed = ErrorBody.safeParse(body);
    if (parsed.success) {
      code = parsed.data.error.code;
      message = parsed.data.error.message;
      details = parsed.data.error.details;
    }
  } catch {
    // 非 JSON 错误体 → 保留通用文案
  }
  throw new ApiError(res.status, code, message, details);
}

export async function apiGet<T>(url: string, schema?: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) return throwFromResponse(res);
  const data = await res.json();
  return schema ? schema.parse(data) : (data as T);
}

async function apiSend<T>(url: string, method: string, body?: unknown, schema?: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return throwFromResponse(res);
  const data = await res.json().catch(() => ({}));
  return schema ? schema.parse(data) : (data as T);
}

export const apiPost = <T>(url: string, body?: unknown, schema?: z.ZodType<T>) =>
  apiSend<T>(url, "POST", body, schema);
export const apiPatch = <T>(url: string, body?: unknown, schema?: z.ZodType<T>) =>
  apiSend<T>(url, "PATCH", body, schema);
export const apiDelete = <T>(url: string, body?: unknown, schema?: z.ZodType<T>) =>
  apiSend<T>(url, "DELETE", body, schema);
