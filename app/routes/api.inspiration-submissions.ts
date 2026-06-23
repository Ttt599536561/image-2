// /api/inspiration-submissions（§13.1 用户投稿）。GET=我的投稿；POST=提交（从「我的作品」选图）。
// server-only；requireUserStrict（敏感写·每请求查 DB·封禁拦截）。不扣积分。
import { InspirationSubmitRequest } from "../../src/contracts/inspirationSubmission";
import { httpError } from "../../src/contracts/error";
import { requireUserStrict } from "../../src/lib/guard";
import { listMySubmissions, submitInspiration } from "../../src/server/inspirationSubmissions.server";
import type { Route } from "./+types/api.inspiration-submissions";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUserStrict(request);
    return Response.json(await listMySubmissions(ctx.userId));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.inspiration-submissions] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request);
    let input: InspirationSubmitRequest;
    try {
      input = InspirationSubmitRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    return Response.json(await submitInspiration(ctx.userId, input));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.inspiration-submissions] action error", e);
    return httpError(500, "INTERNAL", "投稿失败，请重试");
  }
}
