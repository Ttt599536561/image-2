// POST /api/notifications/read（07 §8.3）。缺省 ids → 全标该用户未读为已读。
import { httpError } from "../../src/contracts/error";
import { MarkReadRequest } from "../../src/contracts/notification";
import { requireUser } from "../../src/lib/guard";
import { markNotificationsRead } from "../../src/server/reads.server";
import type { Route } from "./+types/api.notifications.read";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUser(request);
    let body: MarkReadRequest = {};
    try {
      const raw = await request.json();
      body = MarkReadRequest.parse(raw ?? {});
    } catch {
      // 空体/无 ids → 全标
    }
    return Response.json(await markNotificationsRead(ctx.userId, body.ids));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.notifications.read] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
