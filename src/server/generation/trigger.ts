// Legacy Netlify/disposable compatibility trigger. Docker web does not call this helper;
// its persistent worker polls PostgreSQL directly. The body intentionally contains only
// generationId. Keep the awaited request while compatibility callers remain.
export async function triggerBackground(generationId: string): Promise<void> {
  const disposableLocal = process.env.DISPOSABLE_TEST_DB_DRIVER === "pg";
  const base = disposableLocal
    ? "http://localhost:8888"
    : process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      (process.env.NETLIFY_DEV ? "http://localhost:8888" : undefined);
  if (!base) {
    console.error("[triggerBackground] 兼容环境缺少 URL/DEPLOY_PRIME_URL，跳过触发");
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
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
    if (!resp.ok) console.error(`[triggerBackground] 兼容后台返回 ${resp.status}`);
  } catch (e) {
    console.error("[triggerBackground] 兼容触发失败", e);
  } finally {
    clearTimeout(timer);
  }
}
