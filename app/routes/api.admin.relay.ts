// /api/admin/relay（中转站配置）。GET=当前配置（脱敏：base 明文 + key 只回 hint）；POST=校验后写 + 审计。
// 🔴 双守卫之二：requireAdmin（每请求查 DB role + 未封禁）；key 写后即焚、绝不回明文。
import { RelayConfigUpdateRequest } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { getRelayConfig, updateRelayConfig } from "../../src/server/admin/relay-config.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.relay";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await getRelayConfig());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.relay] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    let body: RelayConfigUpdateRequest;
    try {
      body = RelayConfigUpdateRequest.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    const r = await updateRelayConfig({
      adminId: admin.userId,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      ip: clientIp(request),
    });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof Response) return e; // 400 校验失败 / 403
    console.error("[api.admin.relay] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
