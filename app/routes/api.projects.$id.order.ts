// POST /api/projects/:id/order（F-074）。项目内会话整组重排（跨项目移动不支持），敏感写。
import { ProjectOrderRequest, ProjectOrderResponse } from "../../src/contracts/project";
import { httpError } from "../../src/contracts/error";
import { requireUserStrict } from "../../src/lib/guard";
import { reorderProjectConversations } from "../../src/server/projects.server";
import type { Route } from "./+types/api.projects.$id.order";

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let req: ProjectOrderRequest;
    try {
      req = ProjectOrderRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "排序请求格式错误");
    }
    const ok = await reorderProjectConversations(ctx.userId, params.id, req.ids);
    if (!ok) return httpError(400, "INVALID_PARAM", "排序列表与项目内会话不一致，请刷新后重试");
    return Response.json(ProjectOrderResponse.parse({ ok: true as const }));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.projects.$id.order] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
