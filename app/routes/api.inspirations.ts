// GET /api/inspirations?category=&q=（07 §8.3）。只读灵感库（§6 建表前用服务端种子）。
import { httpError } from "../../src/contracts/error";
import { requireUser } from "../../src/lib/guard";
import { loadInspirations } from "../../src/server/reads.server";
import type { Route } from "./+types/api.inspirations";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireUser(request);
    const p = new URL(request.url).searchParams;
    return Response.json(loadInspirations(p.get("category") ?? undefined, p.get("q") ?? undefined));
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.inspirations] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
