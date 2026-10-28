// /api/images（07 §8.3）。GET=资产库列表（日期筛选+分页，loader）；DELETE=批量删除（action，敏感写）。
import { DeleteRequest, DeleteResponse, type ImageRange } from "../../src/contracts/image";
import { httpError } from "../../src/contracts/error";
import { requireUser, requireUserStrict } from "../../src/lib/guard";
import { deleteImages, loadImages } from "../../src/server/reads.server";
import type { Route } from "./+types/api.images";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    const p = new URL(request.url).searchParams;
    const page = p.has("page") ? Number(p.get("page")) : undefined;
    const pageSize = p.has("pageSize") ? Number(p.get("pageSize")) : undefined;
    if (
      (page !== undefined && (!Number.isSafeInteger(page) || page < 1)) ||
      (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100))
    ) {
      return httpError(400, "INVALID_PARAM", "分页参数无效");
    }
    return Response.json(
      await loadImages(ctx.userId, {
        range: (p.get("range") as ImageRange | null) ?? undefined,
        from: p.get("from") ?? undefined,
        to: p.get("to") ?? undefined,
        q: p.get("q")?.slice(0, 200) || undefined, // P3-S2 按提示词搜索
        page,
        pageSize,
      }),
    );
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.images] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "DELETE") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request); // 删除是敏感写，每请求查 DB + 封禁拦截
    let body: DeleteRequest;
    try {
      body = DeleteRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const res = await deleteImages(ctx.userId, body.ids);
    return Response.json(DeleteResponse.parse(res));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.images] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
