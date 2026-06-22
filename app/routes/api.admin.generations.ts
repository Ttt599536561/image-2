// GET /api/admin/generations（09 §10.5）。生成记录（近 7 天/50/倒序，失败行直显三列）。
// POST（#12）：硬删生成记录（单删/批删，级联 images + 清 R2），GenerationAction 判别联合。
import { GenerationAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { deleteGenerations, listGenerations } from "../../src/server/admin/generations.server";
import { clientIp } from "../../src/server/rateLimit";
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

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: GenerationAction;
    try {
      act = GenerationAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const ids = act.op === "delete_generation" ? [act.id] : act.ids;
    const r = await deleteGenerations({ adminId: admin.userId, ids, ip });
    return Response.json(r);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.generations] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
