// GET /api/conversations?page=&pageSize=（07 §8.3）。客户端 ["conversations"] refetch（新建/续聊后刷新侧栏）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadConversations } from "../../src/server/reads.server";
import type { Route } from "./+types/api.conversations";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
    const q = url.searchParams.get("q")?.slice(0, 200) || undefined; // P3-S2 标题搜索
    return Response.json(await loadConversations(ctx.userId, page, pageSize, q));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.conversations] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
