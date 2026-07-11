// Scheduled Function（每分钟，schedule 在 netlify.toml）：DB-as-queue 兜底（真相源 04 §5.5 / 10 §11.6）。
//  ① rescanTimeouts：queued/claimed/running 超 5min → failed/provider_timeout（权威释放并发、未扣费）。
//  ② dispatchStaleQueued：deadline 内仍 queued 的行 await 短触发请求，不等待 background job。
// 顺序：先 rescan（把 >5min 孤儿收 failed）再 dispatch（只补 1–5min），避免重新触发即将被判超时的行。
//
// 🔴 红线：cron 非 -background 后缀；handler try/catch → alert(cron_failed) + Sentry，绝不静默吞；扫描走 HTTP。
import { alert } from "../../src/server/alert.server";
import { dispatchStaleQueued, rescanTimeouts } from "../../src/server/generation/scan.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const timedOut = await rescanTimeouts();
    if (timedOut.length > 0) {
      await alert("queue_timeout_rescan", { count: timedOut.length, ids: timedOut.map((g) => g.id) });
    }
    const redispatched = await dispatchStaleQueued();
    return Response.json({ ok: true, timedOut: timedOut.length, redispatched: redispatched.length });
  } catch (e) {
    await captureException(e, { cron: "timeout-rescan" });
    await alert("cron_failed", { cron: "timeout-rescan" });
    return new Response("cron error", { status: 500 });
  }
}
