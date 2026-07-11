// ★server-only：触发真后台（真相源 04 §5.7）。目标是 *-background 函数，Netlify 见后缀即
// 「立即回 202（仅表示已受理）、后台独立跑满 15min」，发起方不阻塞、不等出图结果。
// body 仅 {generationId}，不带任何 Key/input 明细（铁律④）。
//
// ⚡ 关键修复（出图慢的真因）：必须 **await** 这次触发 fetch，绝不能 `void fetch` 发完即不管。
//   serverless 在 handler 返回后会冻结/回收实例，未 await 的 fire-and-forget fetch 常在「请求真正发出去之前」
//   就被掐死 → 后台函数压根没被拉起 → 任务只能干等每分钟一次的兜底 cron（§5.5），白白多排队 1-2 分钟。
//   `-background` 会秒回 202，await 只多一个往返就把触发变可靠；超时兜底防偶发 hang 阻塞调用方的 202。
//   触发失败仍只记日志、绝不抛（不影响已入队的 202；兜底 cron 会补派发）。
export async function triggerBackground(generationId: string): Promise<void> {
  const disposableLocal = process.env.DISPOSABLE_TEST_DB_DRIVER === "pg";
  const base = disposableLocal
    ? "http://localhost:8888"
    : process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      (process.env.NETLIFY_DEV ? "http://localhost:8888" : undefined);
  if (!base) {
    // 生产环境 URL 必有；本地非 netlify dev 时缺失 → 记日志、不抛（兜底 cron 会扫 queued）。
    console.error("[triggerBackground] 缺少 URL/DEPLOY_PRIME_URL，跳过触发（依赖 §5.5 兜底 cron 派发 queued）");
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000); // 兜底：偶发 hang 不阻塞调用方（cron 会补派发）
  try {
    const path = disposableLocal
      ? "/api/generate-background"
      : "/.netlify/functions/generate-background";
    const resp = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId }),
      signal: ctrl.signal,
    });
    if (!resp.ok) console.error(`[triggerBackground] 后台返回 ${resp.status}（不影响已 202，兜底见 §5.5）`);
  } catch (e) {
    console.error("[triggerBackground] 触发失败（不影响已 202，兜底见 §5.5）", e);
  } finally {
    clearTimeout(timer);
  }
}
