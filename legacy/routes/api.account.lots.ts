// GET /api/account/lots?page=&pageSize=（#8）。本人积分批次（含有效期，倒序分页）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadLots } from "../../src/server/reads.server";
import type { Route } from "./+types/api.account.lots";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    const p = new URL(request.url).searchParams;
    const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(p.get("pageSize") ?? 20) || 20));
    return Response.json(await loadLots(ctx.userId, page, pageSize));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.account.lots] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
