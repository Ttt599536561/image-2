// GET /api/admin/dashboard（09 §10.7）。7 卡 + 附加指标（events/lots/generations 三口径，SUM string codec）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { loadDashboard } from "../../src/server/admin/dashboard.server";
import type { Route } from "./+types/api.admin.dashboard";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await loadDashboard());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.dashboard] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
