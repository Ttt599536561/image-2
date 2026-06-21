// ★server-only：触发真后台（真相源 04 §5.7）。fire-and-forget：行已 queued、202 已可返回，
// 触发失败只记日志、绝不抛（不影响已 202）；§5.5 常驻 Scheduled 派发 + 超时 cron 扫超龄 queued 兜底。
//
// 关键差异：目标是 *-background 函数，Netlify 见后缀即「立即 202、后台独立跑满 15min」，发起方不阻塞、不等结果。
// body 仅 {generationId}，不带任何 Key/input 明细（铁律④）。
export async function triggerBackground(generationId: string): Promise<void> {
  const base =
    process.env.URL || process.env.DEPLOY_PRIME_URL || (process.env.NETLIFY_DEV ? "http://localhost:8888" : undefined);
  if (!base) {
    // 生产环境 URL 必有；本地非 netlify dev 时缺失 → 记日志、不抛（兜底 cron 会扫 queued）。
    console.error("[triggerBackground] 缺少 URL/DEPLOY_PRIME_URL，跳过触发（依赖 §5.5 兜底 cron 派发 queued）");
    return;
  }
  void fetch(`${base}/.netlify/functions/generate-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationId }),
  }).catch((e) => {
    console.error("[triggerBackground] 触发失败（不影响已 202，兜底见 §5.5）", e);
  });
}
