// /api/admin/packages（09 §10.6）。GET=全部套餐(含未上架)；POST=create/update/软删(PackageAction)。
import { PackageAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { createPackage, listAllPackages, softDeletePackage, updatePackage } from "../../src/server/admin/packages.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.admin.packages";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await listAllPackages());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.packages] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const ip = clientIp(request);
    let act: PackageAction;
    try {
      act = PackageAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }
    if (act.op === "create") {
      // act 含 PackageFields 全部字段（+op）；多余 op 被 PackageFields 类型忽略，server 只读已知字段。
      const r = await createPackage({ adminId: admin.userId, fields: act, ip });
      return Response.json({ ok: true, id: r.id });
    }
    if (act.op === "update") {
      await updatePackage({ adminId: admin.userId, id: act.id, fields: act, ip });
      return Response.json({ ok: true });
    }
    await softDeletePackage({ adminId: admin.userId, id: act.id, ip });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.packages] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
