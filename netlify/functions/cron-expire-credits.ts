// Scheduled Function（北京 00:10 = UTC 16:10，schedule 在 netlify.toml）：积分过期清零（真相源 03 §4.8 / 10 §11.2）。
// 把「到期仍有余」的批次清零 + 写 expire 流水（uq_expire_lot 幂等）+ 逐笔同步物化余额。永久批次（expires_at IS NULL）跳过。
//
// 🔴 红线：钱 cron 走 Pool/WS 事务（expireCredits 内部 tx + FOR UPDATE）；排在对账 cron 之前（先清过期、未过期口径才一致）；
//    cron try/catch → alert(cron_failed) + Sentry，绝不静默吞。
import { alert } from "../../src/server/alert.server";
import { expireCredits } from "../../src/server/money/expire.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const r = await expireCredits();
    return Response.json({ ok: true, expiredLots: r.expiredLots, totalMp: r.totalMp });
  } catch (e) {
    await captureException(e, { cron: "expire-credits" });
    await alert("cron_failed", { cron: "expire-credits", error: String(e) });
    return new Response("cron error", { status: 500 });
  }
}
