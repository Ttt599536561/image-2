// GET /api/packages（07 §8.3）。前台充值套餐（active+sort）。公开读（但仍需登录态才用得到，挂受保护壳内）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadPackages } from "../../src/server/reads.server";
import type { Route } from "./+types/api.packages";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireUser(request);
    return Response.json(await loadPackages());
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.packages] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
