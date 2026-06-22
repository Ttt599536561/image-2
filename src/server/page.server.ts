// ★server-only：UI 路由 loader 守卫（08 §9.1）。失败抛 redirect（区别于资源路由/函数的 JSON httpError）。
// 受保护页统一挂 _app 父 loader；未登录 → /login?next=；封禁 → /login?reason=banned。
// 普通读路径可吃 cookieCache（快）；钱/写/封禁硬校验在 requireUserStrict（guard.ts），不在此。
import { redirect } from "react-router";
import { getSql } from "../db/db.server";
import { auth } from "../lib/auth";

export interface PageUser {
  userId: string;
  role: string;
}

export async function requireUserPage(request: Request): Promise<PageUser> {
  const s = await auth.api.getSession({ headers: request.headers });
  if (!s) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if ((s.user as { banned?: boolean }).banned === true) throw redirect("/login?reason=banned");
  return { userId: s.user.id, role: (s.user as { role?: string }).role ?? "user" };
}

/**
 * 后台 _admin 布局 loader 守卫（09 §10.1 / #14）：每请求查 DB（不吃 cookieCache）+ role=admin + 未封禁。
 * 未登录 → /admin/login（后台独立登录页，UX 与用户端彻底分离）；
 * 已登录非 admin → "/"（不暴露后台存在）。与「每个 /api/admin/* 各自 requireAdmin」构成双守卫。
 */
export async function requireAdminPage(request: Request): Promise<PageUser> {
  const s = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!s) throw redirect("/admin/login");
  const rows = await getSql()`SELECT role, is_banned FROM users WHERE id=${s.user.id} LIMIT 1`;
  const row = rows[0] as { role?: string; is_banned?: boolean } | undefined;
  if (!row || row.is_banned || row.role !== "admin") throw redirect("/");
  return { userId: s.user.id, role: "admin" };
}
