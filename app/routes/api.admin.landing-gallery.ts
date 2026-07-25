// /api/admin/landing-gallery（F-073）。GET=全部(含未上架)；POST=create/update/reorder/delete(LandingGalleryAction)。
import { LandingGalleryAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import {
  createLandingItem,
  deleteLandingItem,
  listAllLandingItems,
  reorderLandingItem,
  updateLandingItem,
} from "../../src/server/admin/landing-gallery.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.landing-gallery";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await listAllLandingItems());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.landing-gallery] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: LandingGalleryAction;
    try {
      act = LandingGalleryAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    if (act.op === "create") {
      const r = await createLandingItem({ adminId: admin.userId, fields: act, ip });
      return Response.json({ ok: true, id: r.id });
    }
    if (act.op === "update") {
      await updateLandingItem({ adminId: admin.userId, id: act.id, fields: act, ip });
      return Response.json({ ok: true });
    }
    if (act.op === "reorder") {
      await reorderLandingItem({ adminId: admin.userId, id: act.id, direction: act.direction, ip });
      return Response.json({ ok: true });
    }
    await deleteLandingItem({ adminId: admin.userId, id: act.id, ip });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.landing-gallery] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
