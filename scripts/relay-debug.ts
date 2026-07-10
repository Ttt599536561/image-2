// 中转生图诊断：复刻 callRelay 的请求，打印 URL/payload + 计时 + 响应，定位超时/参数问题。
// 跑：node --env-file=.env --import tsx scripts/relay-debug.ts "<prompt>" <size>
//   例：node --env-file=.env --import tsx scripts/relay-debug.ts "a golden retriever puppy" 1536x1024
import {
  buildImageGenerationPayload,
  buildImageGenerationUrl,
  parseImageGenerationResponse,
} from "../src/api/imageGeneration";
import { redactText } from "../src/lib/redaction";

async function main() {
  const prompt = process.argv[2] || "a golden retriever puppy on green grass, studio light";
  const size = process.argv[3] || "1024x1024";
  const key = process.env.RELAY_API_KEY;
  const base = process.env.RELAY_BASE_URL;
  if (!key || !base) {
    console.error("缺 RELAY_API_KEY / RELAY_BASE_URL");
    process.exit(1);
  }
  const url = buildImageGenerationUrl(base);
  const payload = buildImageGenerationPayload({
    model: "gpt-image-2",
    prompt,
    size,
    quality: "auto",
    background: "auto",
    moderation: "low",
    n: 1,
  });
  console.log("RELAY_BASE_URL:", base);
  console.log("POST URL      :", url);
  console.log("payload       :", JSON.stringify(payload));
  const t0 = Date.now();
  const ctrl = new AbortController();
  const TIMEOUT_MS = 210_000; // 3.5min，比应用 4.5min 软超时短，足够看出是否>3min
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ms = Date.now() - t0;
    const text = await resp.text();
    console.log(`\n→ status ${resp.status} in ${(ms / 1000).toFixed(1)}s`);
    console.log("→ body[0:500]:", redactText(text, [key]).slice(0, 500));
    try {
      const json = JSON.parse(text);
      const imgs = parseImageGenerationResponse(json);
      console.log(`→ parsed ${imgs.length} image(s), kind=${imgs[0]?.kind}`);
    } catch (e) {
      console.log("→ parse note:", redactText(String(e), [key]).slice(0, 120));
    }
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(
      `\n→ ERROR after ${(ms / 1000).toFixed(1)}s: ${(e as Error).name} ${redactText((e as Error).message, [key])}`,
    );
  } finally {
    clearTimeout(timer);
  }
  process.exit(0);
}

main();
