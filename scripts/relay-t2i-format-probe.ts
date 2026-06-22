// 探测：文生图 /images/generations（gpt-image-2）—— 默认返回 b64 还是临时 url？强制 response_format=b64_json 是否被中转接受并回 b64？
// 直打中转（用 .env 的 RELAY_*，不走我们的入队/积分；但会产生中转真实出图费 ×2）。
// 跑：node --env-file=.env --import tsx scripts/relay-t2i-format-probe.ts
import { buildImageGenerationUrl } from "../src/api/imageGeneration";

const base = process.env.RELAY_BASE_URL;
const key = process.env.RELAY_API_KEY;
if (!base || !key) throw new Error("缺 RELAY_BASE_URL / RELAY_API_KEY");

const BASE_BODY: Record<string, unknown> = {
  model: "gpt-image-2",
  prompt: "a single red apple on a plain white table, studio photo",
  size: "1024x1024",
  quality: "auto",
  background: "auto",
  moderation: "low",
  n: 1,
};

async function callGen(label: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const resp = await fetch(buildImageGenerationUrl(base as string), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  const item = json?.data?.[0] ?? json?.output?.[0] ?? null;
  const hasB64 = !!(item && typeof item.b64_json === "string");
  const hasUrl = !!(
    item &&
    (typeof item.url === "string" || typeof item.image_url === "string" || (typeof item === "string" && /^https?:/.test(item)))
  );
  const ms = Date.now() - t0;
  console.log(
    `[${label}] http=${resp.status} ${ms}ms  b64=${hasB64} url=${hasUrl}` +
      (hasUrl && item ? `  url=${(item.url || item.image_url || "").slice(0, 60)}…` : "") +
      (!item ? `  body=${text.slice(0, 180)}` : ""),
  );
  return { status: resp.status, hasB64, hasUrl };
}

async function main() {
  console.log(`中转 base=${base}`);
  console.log("—— A) 默认（不带 response_format）——");
  const a = await callGen("默认", BASE_BODY);
  console.log("—— B) 强制 response_format=b64_json ——");
  const b = await callGen("强制b64", { ...BASE_BODY, response_format: "b64_json" });

  console.log("\n==== 结论 ====");
  console.log(`默认文生图：${a.hasB64 ? "回 b64（已内联，无二次下载）" : a.hasUrl ? "回临时 url（putToR2 需二次下载）" : "异常"}`);
  console.log(
    `强制 b64_json：${b.status === 200 && b.hasB64 ? "✅ 被接受且回 b64 → 加上安全" : b.hasUrl ? "仍回 url（中转不透传该参数）→ 加了无效" : `异常(${b.status})`}`,
  );
  const shouldAdd = b.status === 200 && b.hasB64;
  console.log(`\n建议：${shouldAdd ? "加 response_format=b64_json（保证内联 b64、免二次下载/免临时链接过期）" : "不加（中转不接受/不透传，避免破坏文生图）"}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
