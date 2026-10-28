// /api/admin/users/:id（09 §10.3）。GET=详情；POST=行尾「⋯」操作（ban/reset_pw/adjust_credit/set_concurrency）。
// 🔴 钱写调 ③ adjustCredit；封禁以业务 is_banned 为权威 + 最佳努力 Better Auth 吊销会话；改密走 Better Auth + 吊销会话、不记明文。
import { UserAction } from "../../src/contracts/admin";
import { httpError } from "../../src/contracts/error";
import { auth } from "../../src/lib/auth";
import { requireAdmin } from "../../src/lib/guard";
import { writeAuditHttp } from "../../src/server/admin/audit.server";
import { setBanned, setConcurrency } from "../../src/server/admin/users.server";
import { adjustCredit } from "../../src/server/money/adjust.server";
import { clientIp } from "../../src/server/rateLimit";
import { getUserDetail } from "../../src/server/admin/users.server";
import type { Route } from "./+types/api.admin.users.$id";

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    return Response.json(await getUserDetail(params.id));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.users.$id] loader error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const admin = await requireAdmin(request);
    const id = params.id;
    const ip = clientIp(request);
    let action: UserAction;
    try {
      action = UserAction.parse(await request.json());
    } catch {
      return httpError(400, "INVALID_PARAM", "参数无效");
    }

    switch (action.op) {
      case "adjust_credit": {
        // 调积分走 ③（同事务动 lots+物化余额+ledger+audit+events）。
        const r = await adjustCredit({
          adminId: admin.userId,
          userId: id,
          deltaMp: action.deltaMp,
          reason: action.reason,
          validDays: action.validDays ?? null,
          ip,
        });
        return Response.json({ ok: true, moved: r.moved, before: r.before, after: r.after });
      }
      case "set_concurrency": {
        await setConcurrency({ adminId: admin.userId, userId: id, maxConcurrency: action.maxConcurrency, ip });
        return Response.json({ ok: true });
      }
      case "ban": {
        // 业务 is_banned 权威（requireUserStrict 每请求查）+ 审计；再最佳努力 Better Auth 吊销会话/写 banned。
        await setBanned({ adminId: admin.userId, userId: id, banned: action.banned, reason: action.reason ?? null, ip });
        try {
          if (action.banned) await auth.api.banUser({ body: { userId: id }, headers: request.headers });
          else await auth.api.unbanUser({ body: { userId: id }, headers: request.headers });
        } catch (e) {
          console.error("[admin ban] Better Auth ban/unban 失败（is_banned 已生效，会话由 requireUserStrict 拦）", e);
        }
        return Response.json({ ok: true });
      }
      case "reset_pw": {
        // 密码存 Better Auth account 表 → 必经 Better Auth；password.hash 内 72 字节断言；改后吊销全部会话强制重登。
        await auth.api.setUserPassword({ body: { userId: id, newPassword: action.newPassword }, headers: request.headers });
        try {
          await auth.api.revokeUserSessions({ body: { userId: id }, headers: request.headers });
        } catch (e) {
          console.error("[admin reset_pw] revokeUserSessions 失败（密码已改，建议用户手动重登）", e);
        }
        // 不记明文：after 只标 {changed:true}（05 §6.5 / 09 §10.6）。
        await writeAuditHttp({ adminId: admin.userId, action: "reset_pw", targetType: "user", targetId: id, after: { changed: true }, ip });
        return Response.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.users.$id] action error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
