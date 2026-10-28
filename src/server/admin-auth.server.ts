import { httpError } from "../contracts/error";
import { getSql } from "../db/db.server";
import { auth } from "../lib/auth";
import { clientIp, isRateLimited, recordRateFailure } from "./rateLimit";
import { readLimitedBody } from "./studio/request.server";

/** The account product is retired; these are administrative operations only. */
export async function handleAdminAuth(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/get-session") {
    const response = await auth.handler(request);
    if (!response.ok) return response;
    const data = await response.clone().json().catch(() => null) as { user?: { role?: string } } | null;
    return data?.user && data.user.role !== "admin" ? Response.json(null) : response;
  }
  if (request.method === "POST" && path === "/api/auth/sign-out") return auth.handler(request);
  if (request.method !== "POST" || path !== "/api/auth/sign-in/email") return httpError(404, "NOT_FOUND", "接口不存在");
  try {
    const raw = new TextDecoder().decode(await readLimitedBody(request, 16_384));
    let body: { email?: unknown };
    try { body = JSON.parse(raw); } catch { return httpError(400, "INVALID_PARAM", "请求体无效"); }
    const subject = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const ip = clientIp(request);
    if (await isRateLimited("sign_in", { ip, subject })) return httpError(429, "RATE_LIMITED", "尝试过多，请稍后再试");
    const rows = subject.length <= 254 && subject.includes("@") ? await getSql()`
      SELECT b.id FROM users b JOIN "user" a ON a.id=b.id
      WHERE lower(b.email)=${subject} AND b.role='admin' AND a.role='admin'
        AND b.is_banned=false AND COALESCE(a.banned,false)=false LIMIT 1` : [];
    if (!rows.length) {
      await recordRateFailure("sign_in", { ip, subject }).catch(() => {});
      return httpError(401, "INVALID_EMAIL_OR_PASSWORD", "邮箱或密码错误");
    }
    const response = await auth.handler(new Request(request, { body: raw }));
    if (response.status >= 400) await recordRateFailure("sign_in", { ip, subject }).catch(() => {});
    return response;
  } catch (error) {
    if (error instanceof Response) return error;
    return httpError(500, "INTERNAL", "暂时无法登录，请稍后重试");
  }
}
