// /api/admin/inspirations（09 §10.4）。GET=全部(含未上架)；POST=create/update/delete(InspirationAction)。
import { InspirationAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import {
  createInspiration,
  deleteInspiration,
  listAllInspirations,
  updateInspiration,
} from "../../src/server/admin/inspirations.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.inspirations";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await listAllInspirations());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.inspirations] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: InspirationAction;
    try {
      act = InspirationAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    if (act.op === "create") {
      const r = await createInspiration({ adminId: admin.userId, fields: act, ip });
      return Response.json({ ok: true, id: r.id });
    }
    if (act.op === "update") {
      await updateInspiration({ adminId: admin.userId, id: act.id, fields: act, ip });
      return Response.json({ ok: true });
    }
    await deleteInspiration({ adminId: admin.userId, id: act.id, ip });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.inspirations] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
