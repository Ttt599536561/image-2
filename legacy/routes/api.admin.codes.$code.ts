// GET /api/admin/codes/:code（09 §10.2）。查单码状态。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { getCodeStatus } from "../../src/server/admin/codes.server";
import type { Route } from "./+types/api.admin.codes.$code";

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const r = await getCodeStatus(params.code.toUpperCase());
    if (!r) return httpError(404, "CODE_NOT_FOUND", "兑换码不存在");
    return Response.json(r);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.codes.$code] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
