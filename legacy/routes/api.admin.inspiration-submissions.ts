// /api/admin/inspiration-submissions（§13.1 投稿审核）。GET=队列（按状态筛+分页）；POST=approve|reject。
// 每路由各自 requireAdmin = 双守卫之一。
import { SubmissionReviewAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import {
  approveSubmission,
  listSubmissions,
  rejectSubmission,
} from "../../src/server/admin/inspirationReview.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.inspiration-submissions";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const p = new URL(request.url).searchParams;
    const status = p.get("status") ?? undefined;
    const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
    return Response.json(await listSubmissions({ status, page }));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.inspiration-submissions] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: SubmissionReviewAction;
    try {
      act = SubmissionReviewAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    if (act.op === "approve") {
      const r = await approveSubmission({ adminId: admin.userId, id: act.id, fields: act, ip });
      return Response.json({ ok: true, inspirationId: r.inspirationId });
    }
    await rejectSubmission({ adminId: admin.userId, id: act.id, reason: act.reason, ip });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.inspiration-submissions] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
