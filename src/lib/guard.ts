// ★server-only：鉴权守卫（05 §6.3 / §6.7）。失败抛统一错误信封 Response（RR loader/action + functions 通吃）。
// 🔴 红线：敏感/钱/封禁路径必须 requireUserStrict（disableCookieCache 每请求查 DB），不吃 300s cookieCache。
import { httpError } from "../contracts/error";
import { getSql } from "../db/db.server";
import { auth } from "./auth";

export type UserCtx = { userId: string; role: string };
export type StrictCtx = { userId: string; role: string; maxConcurrency: number };

/** 普通受保护读路径：可吃 cookieCache（快）。role 取自会话（admin 插件注入）。 */
export async function requireUser(request: Request): Promise<UserCtx> {
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) throw httpError(401, "UNAUTHENTICATED", "请先登录");
  const role = (s.user as { role?: string }).role ?? "user";
  return { userId: s.user.id, role };
}

/**
 * 敏感路由（生成/兑换/账号/admin）：强制每请求查 DB（disableCookieCache），核对封禁 + 取热路径字段。
 * 封禁双源都查（业务 users.is_banned 为权威；Better Auth user.banned 兜底，见 ⑥ 调和）。
 */
export async function requireUserStrict(request: Request): Promise<StrictCtx> {
  const s = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!s) throw httpError(401, "UNAUTHENTICATED", "会话已失效，请重新登录");
  const rows = await getSql()`SELECT id, role, max_concurrency, is_banned FROM users WHERE id=${s.user.id} LIMIT 1`;
  if (rows.length === 0) throw httpError(401, "UNAUTHENTICATED", "会话已失效，请重新登录");
  const row = rows[0] as { id: string; role: string; max_concurrency: number; is_banned: boolean };
  const banned = row.is_banned || (s.user as { banned?: boolean }).banned === true;
  if (banned) throw httpError(403, "BANNED", "账号已被封禁，请联系站长");
  return { userId: row.id, role: row.role, maxConcurrency: row.max_concurrency };
}

/** admin 守卫：每请求查 DB + 未封禁 + role=admin（05 §6.7）。 */
export async function requireAdmin(request: Request): Promise<StrictCtx> {
  const ctx = await requireUserStrict(request);
  if (ctx.role !== "admin") throw httpError(403, "FORBIDDEN", "无权限");
  return ctx;
}
