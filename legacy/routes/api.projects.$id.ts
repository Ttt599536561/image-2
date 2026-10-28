// PATCH /api/projects/:id（F-074）。owner-scoped 重命名项目（默认项目允许），敏感写。
import { ProjectNameRequest } from "../../src/contracts/project";
import { httpError } from "../../src/contracts/error";
import { requireUserStrict } from "../../src/lib/guard";
import { renameProject } from "../../src/server/projects.server";
import type { Route } from "./+types/api.projects.$id";

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== "PATCH") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let req: ProjectNameRequest;
    try {
      req = ProjectNameRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "项目名需为 1–50 字");
    }
    const name = req.name.trim();
    if (!name) return httpError(400, "INVALID_PARAM", "项目名不能为空");
    const res = await renameProject(ctx.userId, params.id, name);
    if (!res) return httpError(404, "NOT_FOUND", "项目不存在");
    return Response.json(res);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.projects.$id] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
