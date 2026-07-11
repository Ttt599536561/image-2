// Timeout rescan job. Docker scheduler runs it every minute.
// queued/claimed/running 到达 deadline → failed/provider_timeout（权威释放并发、未扣费）。
//
// 🔴 红线：只收口超时，不派发 queued；持久 worker 负责消费。失败必须告警，不能静默吞。
import { alert } from "../../src/server/alert.server";
import { rescanTimeouts } from "../../src/server/generation/scan.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const timedOut = await rescanTimeouts();
    if (timedOut.length > 0) {
      await alert("queue_timeout_rescan", { count: timedOut.length, ids: timedOut.map((g) => g.id) });
    }
    return Response.json({ ok: true, timedOut: timedOut.length });
  } catch (e) {
    await captureException(e, { cron: "timeout-rescan" });
    await alert("cron_failed", { cron: "timeout-rescan" });
    return new Response("cron error", { status: 500 });
  }
}
