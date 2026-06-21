// Scheduled Function（北京 00:00 = UTC 16:00，schedule 在 netlify.toml）：旧预算键清理 + 昨日 ms 重算 + 回溯近阈/熔断日报。
// 真相源 10 §11.8。跨天靠 date-in-key 自动归零（无需清零当日键）；本 cron 删 7 天前旧键 + 用 generations.duration_ms
// 之和重算覆盖**昨日** ms（cron 跑在 0 点、今天 calls/ms≈0，评估今天告警是死代码 → 回看刚结束的昨天才有意义）。
//
// 🔴 红线：cron try/catch → alert(cron_failed) + Sentry；扫描走 HTTP。
// 注：**实时「命中即告警」在 src/server/generation/process.ts 硬上限命中分支**（防破产、当天首次即发）；本 cron 只补昨日回溯日报。
import { alert } from "../../src/server/alert.server";
import { cleanupBudgetKeys } from "../../src/server/budget.server";
import { captureException } from "../../src/server/sentry.server";

export default async function handler(): Promise<Response> {
  try {
    const r = await cleanupBudgetKeys();
    if (r.budgetExhausted || r.nearThreshold) {
      await alert("daily_budget_exhausted", {
        retrospective: true, // 昨日回溯日报（非实时熔断；实时在 process.ts）
        date: r.evaluatedDate,
        exhausted: r.budgetExhausted,
        near: r.nearThreshold && !r.budgetExhausted,
        calls: r.calls,
        callsCap: r.callsCap,
        ms: r.recomputedMs,
        msCap: r.msCap,
      });
    }
    return Response.json({ ok: true, ...r });
  } catch (e) {
    await captureException(e, { cron: "budget-cleanup" });
    await alert("cron_failed", { cron: "budget-cleanup", error: String(e) });
    return new Response("cron error", { status: 500 });
  }
}
