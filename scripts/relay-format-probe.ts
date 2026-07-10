// 中转 output_format 透传探测（验收 #9 前置）：分别请求 png / jpeg，解码返回图的「魔数」判定真实格式。
// gpt-image-2 官方对 webp 会忽略并回 PNG（issue#1850）；本脚本确认中转对 png/jpeg 是否真透传。
// 跑：node --env-file=.env --import tsx scripts/relay-format-probe.ts
import { buildImageGenerationUrl } from "../src/api/imageGeneration";
import { redactText } from "../src/lib/redaction";

function magicOf(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "webp";
  return `unknown(${Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" ")})`;
}

async function probe(base: string, key: string, outputFormat: string): Promise<string | null> {
  const url = buildImageGenerationUrl(base);
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: "a single small red circle on white background, minimal",
      size: "1024x1024",
      moderation: "low",
      n: 1,
      output_format: outputFormat,
    }),
  });
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  const text = await resp.text();
  const safeText = redactText(text, [key]);
  if (!resp.ok) {
    console.log(`  [output_format=${outputFormat}] → ${resp.status} in ${ms}s :: ${safeText.slice(0, 200)}`);
    return null;
  }
  let json: { data?: { b64_json?: string; url?: string }[]; output?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`  [output_format=${outputFormat}] → 200 unparseable in ${ms}s :: ${safeText.slice(0, 160)}`);
    return null;
  }
  const item = json.data?.[0];
  if (item?.b64_json) {
    const bytes = new Uint8Array(Buffer.from(item.b64_json, "base64"));
    const fmt = magicOf(bytes);
    console.log(`  [output_format=${outputFormat}] → 200 in ${ms}s :: b64_json ${bytes.length}B → 实际格式=${fmt}`);
    return fmt;
  }
  if (item?.url) {
    // 极少：返回 url（检查扩展名 / content-type）
    const head = await fetch(item.url);
    const ct = head.headers.get("content-type");
    console.log(`  [output_format=${outputFormat}] → 200 in ${ms}s :: url, content-type=${ct}`);
    return ct?.includes("jpeg") ? "jpeg" : ct?.includes("png") ? "png" : `ct:${ct}`;
  }
  console.log(`  [output_format=${outputFormat}] → 200 in ${ms}s :: 无 b64_json/url，body[0:200]=${safeText.slice(0, 200)}`);
  return null;
}

async function main() {
  const key = process.env.RELAY_API_KEY;
  const base = process.env.RELAY_BASE_URL;
  if (!key || !base) {
    console.error("缺 RELAY_API_KEY / RELAY_BASE_URL");
    process.exit(1);
  }
  console.log(`base=${base} key=PRESENT\n`);
  console.log("探 png（对照）+ jpeg（关键）：");
  const png = await probe(base, key, "png");
  const jpeg = await probe(base, key, "jpeg");
  console.log(
    `\n结论：output_format=png → ${png ?? "失败"}；output_format=jpeg → ${jpeg ?? "失败"}。` +
      `\n${jpeg === "jpeg" ? "✅ 中转真透传 output_format → 实装 #9（png+jpeg 两档）。" : "⚠️ 中转未按 jpeg 返回（被忽略/不支持）→ #9 暂只保留 png，jpeg 档先不放。"}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(`[relay-format-probe] FAIL: ${redactText(String(error), [process.env.RELAY_API_KEY ?? ""])}`);
  process.exitCode = 1;
});
