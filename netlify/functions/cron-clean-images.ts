// Image cleanup job. Docker schedule: 北京 01:00 = UTC 17:00（scripts/scheduler.ts）。
// 顺序 ⓪到期前 1 天预扫写通知 → ①付费顺延兜底 → ②删过期图(先删 R2 再删 DB 行 + image_cleaned) → ③扫孤儿对象。
//
// 🔴 红线：扫描/删行走 HTTP（非钱事务）；先删 R2 再删 DB（反则留孤儿）；删失败的 key 下轮重扫；
//    通知 dedupe_key ON CONFLICT DO NOTHING 防重发；job try/catch → alert(cron_failed) + Sentry。
import { alert } from "../../src/server/alert.server";
import { cleanExpiredImages } from "../../src/server/maintenance.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const r = await cleanExpiredImages();
    if (r.failedKeys > 0) {
      await alert("image_cleanup_failures", { failedKeys: r.failedKeys, deletedImages: r.deletedImages });
    }
    return Response.json({ ok: true, ...r });
  } catch (e) {
    await captureException(e, { cron: "clean-images" });
    await alert("cron_failed", { cron: "clean-images", error: String(e) });
    return new Response("cron error", { status: 500 });
  }
}
