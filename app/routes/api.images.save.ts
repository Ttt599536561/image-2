// POST /api/images/save（07 §8.3 / §5.2「存入资产库」）。置 saved_to_library=true，owner-scoped。
import { httpError } from "../../src/contracts/error";
import { SaveRequest, SaveResponse } from "../../src/contracts/image";
import { requireUserStrict } from "../../src/lib/guard";
import { saveImageToLibrary } from "../../src/server/reads.server";
import type { Route } from "./+types/api.images.save";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let body: SaveRequest;
    try {
      body = SaveRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const res = await saveImageToLibrary(ctx.userId, body.generationId);
    return Response.json(SaveResponse.parse(res));
  } catch (e) {
    if (e instanceof Response) return e; // 404 图片不存在 / 401 / 403
    console.error("[api.images.save] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
