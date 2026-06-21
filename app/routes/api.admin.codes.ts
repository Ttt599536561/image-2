// /api/admin/codes（09 §10.2）。GET=批次列表；POST=生成/作废批次（CodeAction）。
import { CodeAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { disableBatch, generateCodes, listBatches } from "../../src/server/admin/codes.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.codes";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const p = new URL(request.url).searchParams;
    const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
    return Response.json(await listBatches(page));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.codes] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: CodeAction;
    try {
      act = CodeAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    if (act.op === "generate") {
      const r = await generateCodes({ adminId: admin.userId, packageId: act.packageId, count: act.count, ip });
      return Response.json(r);
    }
    const r = await disableBatch({ adminId: admin.userId, batchId: act.batchId, ip });
    return Response.json(r);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.codes] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
