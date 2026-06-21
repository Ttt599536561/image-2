// GET /api/admin/generations（09 §10.5）。生成记录（近 7 天/50/倒序，失败行直显三列）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { listGenerations } from "../../src/server/admin/generations.server";
import type { Route } from "./+types/api.admin.generations";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const p = new URL(request.url).searchParams;
    return Response.json(
      await listGenerations({
        from: p.get("from") ?? undefined,
        to: p.get("to") ?? undefined,
        userEmail: p.get("userEmail") ?? undefined,
        status: p.get("status") ?? undefined,
        page: p.get("page") ? Number(p.get("page")) : undefined,
        pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : undefined,
      }),
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.generations] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
