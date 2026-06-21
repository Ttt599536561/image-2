// GET /api/conversations/:id（07 §8.3）。会话详情（generations 正序 + 图/态），客户端 ["conversation",id] refetch。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadConversationDetail } from "../../src/server/reads.server";
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
