// GET /api/generate-status?id=（短轮询，真相源 04 §5.4 / 07 §8.5）。owner-scoped，按 status 判别联合三态，
// 失败也 200（业务态在体内）。requireUser（读路径、cookieCache 可；轮询 2s 一次，不走每请求查 DB 的 strict）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import {
  loadGenerationStatuses,
  parseGenerationStatusQuery,
} from "../../src/server/generation/status.server";

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUser(req);
    const query = parseGenerationStatusQuery(req.url);
    if (!query.ok) return httpError(400, "INVALID_PARAM", "任务 ID 无效");
    const items = await loadGenerationStatuses(ctx.userId, query.ids);
    if (query.single) {
      if (items.length === 0) return httpError(404, "NOT_FOUND", "任务不存在");
      return Response.json(items[0]);
    }
    const found = new Set(items.map((item) => item.generationId));
    const missingIds = query.ids.filter((id) => !found.has(id));
    return Response.json({ items, missingIds });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[generate-status] internal error");
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
