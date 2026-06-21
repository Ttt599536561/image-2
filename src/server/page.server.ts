// ★server-only：UI 路由 loader 守卫（08 §9.1）。失败抛 redirect（区别于资源路由/函数的 JSON httpError）。
// 受保护页统一挂 _app 父 loader；未登录 → /login?next=；封禁 → /login?reason=banned。
// 普通读路径可吃 cookieCache（快）；钱/写/封禁硬校验在 requireUserStrict（guard.ts），不在此。
import { redirect } from "react-router";
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
