// GET /api/admin/codes/batch/:batchId（09 §10.2）。批次对账（发出/已用/未用/已作废/金额，SUM string codec）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { batchReconcile } from "../../src/server/admin/codes.server";
import type { Route } from "./+types/api.admin.codes.batch.$batchId";

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await batchReconcile(params.batchId));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.codes.batch.$batchId] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
