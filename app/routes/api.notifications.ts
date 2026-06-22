// GET /api/notifications?unread=1（07 §8.3）。站内通知（image_expiring | announcement，owner-scoped）。顶栏铃铛走 TanStack Query。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadNotifications } from "../../src/server/reads.server";
import type { Route } from "./+types/api.notifications";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    const unread = new URL(request.url).searchParams.get("unread") === "1";
    return Response.json(await loadNotifications(ctx.userId, unread));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.notifications] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
