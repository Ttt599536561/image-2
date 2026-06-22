// /api/admin/notifications（§9）。POST=广播公告（AnnouncementAction）。requireAdmin（双守卫之一）+ 写审计（server 层）。
import { AnnouncementAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { broadcastAnnouncement } from "../../src/server/admin/notifications.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.notifications";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: AnnouncementAction;
    try {
      act = AnnouncementAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const res = await broadcastAnnouncement({
      adminId: admin.userId,
      title: act.title,
      body: act.body,
      link: act.link ?? null,
      target: act.target,
      ip,
    });
    return Response.json({ ok: true, inserted: res.inserted });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.notifications] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
