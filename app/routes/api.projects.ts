// GET /api/projects（F-074）。侧栏项目列表（含各项目会话），客户端 ["projects"] refetch。
// POST /api/projects。新建项目（置顶），敏感写。
import { ProjectNameRequest } from "../../src/contracts/project";
import { httpError } from "../../src/contracts/error";
import { requireUser, requireUserStrict } from "../../src/lib/guard";
import { createProject, loadProjects } from "../../src/server/projects.server";
import type { Route } from "./+types/api.projects";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    return Response.json(await loadProjects(ctx.userId));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.projects] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let req: ProjectNameRequest;
    try {
      req = ProjectNameRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "项目名需为 1–50 字");
    }
    const name = req.name.trim(); // 后端 trim 兜底（前端已拦空名）
    if (!name) return httpError(400, "INVALID_PARAM", "项目名不能为空");
    return Response.json(await createProject(ctx.userId, name));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.projects] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
