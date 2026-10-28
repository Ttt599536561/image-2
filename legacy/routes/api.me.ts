// GET /api/me（07 §8.3）。客户端 ["me"] refetch 入口（兑换/生成成功后 invalidate 拉新余额/过期）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadMe } from "../../src/server/reads.server";
import type { Route } from "./+types/api.me";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const ctx = await requireUser(request);
    return Response.json(await loadMe(ctx.userId));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.me] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
