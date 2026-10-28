// GET /api/conversations/:id（07 §8.3）。会话详情（generations 正序 + 图/态），客户端 ["conversation",id] refetch。
// DELETE /api/conversations/:id（#3）。owner-scoped 删会话（级联 generations→images + 尽力删 R2），敏感写。
// PATCH /api/conversations/:id（§10）。owner-scoped 重命名会话（即时持久化），敏感写。
import {
  ConversationDeleteResponse,
  ConversationRenameResponse,
  RenameRequest,
} from "../../src/contracts/conversation";
import { httpError } from "../../src/contracts/error";
import { requireUser, requireUserStrict } from "../../src/lib/guard";
import {
  deleteConversations,
  loadConversationDetail,
  renameConversation,
} from "../../src/server/reads.server";
import type { Route } from "./+types/api.conversations.$id";

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    return Response.json(await loadConversationDetail(ctx.userId, params.id));
  } catch (e) {
    if (e instanceof Response) return e; // 404 会话不存在 / 401
    console.error("[api.conversations.$id] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    // 删除 / 改名都是敏感写：每请求查 DB + 封禁拦截。
    const ctx = await requireUserStrict(request);
    if (request.method === "DELETE") {
      const res = await deleteConversations(ctx.userId, [params.id]);
      if (res.deleted === 0) return httpError(404, "NOT_FOUND", "会话不存在");
      return Response.json(ConversationDeleteResponse.parse(res));
    }
    if (request.method === "PATCH") {
      let req: RenameRequest;
      try {
        req = RenameRequest.parse(await request.json());
      } catch {
        return httpError(400, "INVALID_PARAM", "标题需为 1–200 字");
      }
      const title = req.title.trim(); // 后端 trim 兜底（前端已拦空标题）
      if (!title) return httpError(400, "INVALID_PARAM", "标题不能为空");
      const res = await renameConversation(ctx.userId, params.id, title);
      return Response.json(ConversationRenameResponse.parse(res));
    }
    return httpError(405, "INVALID_PARAM", "method_not_allowed");
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.conversations.$id] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
