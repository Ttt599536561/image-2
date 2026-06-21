// GET /api/admin/users?q=&page=&pageSize=（09 §10.3）。用户搜索（邮箱 ILIKE）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { searchUsers } from "../../src/server/admin/users.server";
import type { Route } from "./+types/api.admin.users";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const p = new URL(request.url).searchParams;
    const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(p.get("pageSize") ?? 50) || 50));
    return Response.json(await searchUsers(p.get("q") ?? undefined, page, pageSize));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.users] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
