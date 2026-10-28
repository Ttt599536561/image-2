// GET /api/admin/audit（09 §10.6）。审计只读列表（倒序，可按 action/target 筛）。无删改端点（只追加）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { listAudit } from "../../src/server/admin/audit.server";
import type { Route } from "./+types/api.admin.audit";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const p = new URL(request.url).searchParams;
    return Response.json(
      await listAudit({
        action: p.get("action") ?? undefined,
        targetType: p.get("targetType") ?? undefined,
        page: p.get("page") ? Number(p.get("page")) : undefined,
        pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : undefined,
      }),
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.audit] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
