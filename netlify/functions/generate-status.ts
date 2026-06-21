// GET /api/generate-status?id=（短轮询，真相源 04 §5.4 / 07 §8.5）。owner-scoped，按 status 判别联合三态，
// 失败也 200（业务态在体内）。requireUser（读路径、cookieCache 可；轮询 2s 一次，不走每请求查 DB 的 strict）。
import { httpError } from "../../src/contracts/error";
import { getSql } from "../../src/db/db.server";
import { requireUser } from "../../src/lib/guard";

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUser(req);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return httpError(400, "INVALID_PARAM", "missing id");

    const rows = await getSql()`
      SELECT g.status, g.error_code, g.error, g.http_status, g.duration_ms, g.started_at, g.credits_charged_mp,
             i.public_url, i.width, i.height
      FROM generations g LEFT JOIN images i ON i.generation_id = g.id
      WHERE g.id=${id} AND g.user_id=${ctx.userId}`; // ★ 限本人，防越权查别人 job
    if (rows.length === 0) return httpError(404, "NOT_FOUND", "任务不存在");

    const g = rows[0] as Record<string, unknown>;
    const intOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

    switch (g.status) {
      case "queued":
      case "claimed":
      case "running": {
        const started = g.started_at ? new Date(g.started_at as string) : null;
        return Response.json(
          {
            status: g.status,
            startedAt: started ? started.toISOString() : undefined,
            elapsedMs: started ? Math.max(0, Date.now() - started.getTime()) : undefined,
          },
          { status: 200 },
        );
      }
      case "succeeded":
        return Response.json(
          {
            status: "succeeded",
            image: { publicUrl: g.public_url, width: intOrNull(g.width), height: intOrNull(g.height) },
            creditsChargedMp: Number(g.credits_charged_mp ?? 0),
            durationMs: Number(g.duration_ms ?? 0),
          },
          { status: 200 },
        );
      default: // failed
        return Response.json(
          { status: "failed", errorCode: g.error_code, error: g.error, httpStatus: intOrNull(g.http_status) },
          { status: 200 },
        );
    }
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[generate-status] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
