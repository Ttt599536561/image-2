// POST /api/projects/order（F-074）。项目整组重排：ids 必须恰为该用户全部项目，敏感写。
import { ProjectOrderRequest, ProjectOrderResponse } from "../../src/contracts/project";
import { httpError } from "../../src/contracts/error";
import { requireUserStrict } from "../../src/lib/guard";
import { reorderProjects } from "../../src/server/projects.server";
import type { Route } from "./+types/api.projects.order";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let req: ProjectOrderRequest;
    try {
      req = ProjectOrderRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "排序请求格式错误");
    }
    const ok = await reorderProjects(ctx.userId, req.ids);
    if (!ok) return httpError(400, "INVALID_PARAM", "排序列表与现有项目不一致，请刷新后重试");
    return Response.json(ProjectOrderResponse.parse({ ok: true as const }));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.projects.order] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
