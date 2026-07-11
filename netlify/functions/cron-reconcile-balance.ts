// Balance reconciliation job. Docker schedule: 北京 00:30 = UTC 16:30（scripts/scheduler.ts）。
// 物化余额 vs 权威余额 SUM(lots.remaining 未过期)，不平 → 先告警再以批次为准修正。**必须排在过期任务(00:10) 之后**
// （先清过期，未过期口径才一致）。
//
// 🔴 红线：SUM 走 ::text + BigInt（毫积分跨 JSON 防精度丢，§11.4）；drift 是 bug 信号（先告警再修正，根因得查事务）；
//    job try/catch → alert(cron_failed) + Sentry。
import { alert } from "../../src/server/alert.server";
import { reconcileBalances } from "../../src/server/money/reconcile.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const r = await reconcileBalances();
    if (r.drifts.length > 0) {
      const totalDriftMp = r.drifts.reduce<string>((s, d) => (BigInt(s) + BigInt(d.driftMp)).toString(), "0");
      await alert("balance_reconcile_mismatch", {
        count: r.drifts.length,
        corrected: r.corrected,
        totalDriftMp,
        sample: r.drifts.slice(0, 20),
      });
    }
    return Response.json({ ok: true, drifts: r.drifts.length, corrected: r.corrected });
  } catch (e) {
    await captureException(e, { cron: "reconcile-balance" });
    await alert("cron_failed", { cron: "reconcile-balance", error: String(e) });
    return new Response("cron error", { status: 500 });
  }
}
