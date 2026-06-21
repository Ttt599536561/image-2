// /api/admin/config（09 §10.6）。GET=全部参数；POST=校验后写（即时生效）。
import { ConfigUpdateRequest } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { getAllConfig, updateConfig } from "../../src/server/admin/config.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.config";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await getAllConfig());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.config] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    let body: ConfigUpdateRequest;
    try {
      body = ConfigUpdateRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const r = await updateConfig({ adminId: admin.userId, updates: body.updates, ip: clientIp(request) });
    return Response.json({ ok: true, updated: r.updated });
  } catch (e) {
    if (e instanceof Response) return e; // 400 校验失败 / 403
    console.error("[api.admin.config] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
