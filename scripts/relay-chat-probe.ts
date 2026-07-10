// 中转 chat/文本模型探测（P3-S6 优化提示词前置）：列出 /models + 试打几个候选 chat 模型。
// 跑：node --env-file=.env --import tsx scripts/relay-chat-probe.ts
import { buildImageGenerationUrl } from "../src/api/imageGeneration";
import { redactText } from "../src/lib/redaction";

const CANDIDATES = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-3.5-turbo",
  "deepseek-chat",
  "qwen-turbo",
  "glm-4-flash",
];

async function listModels(base: string, key: string): Promise<string[]> {
  try {
    const url = buildImageGenerationUrl(base, "/models");
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    console.log(`GET /models → ${resp.status}`);
    if (!resp.ok) {
      console.log("  body[0:300]:", redactText(await resp.text(), [key]).slice(0, 300));
      return [];
    }
    const json = (await resp.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
    console.log(`  ${ids.length} models. sample:`, ids.slice(0, 40).join(", "));
    return ids;
  } catch (e) {
    console.log("  /models error:", redactText(String(e), [key]).slice(0, 200));
    return [];
  }
}

async function tryChat(base: string, key: string, model: string): Promise<boolean> {
  const url = buildImageGenerationUrl(base, "/chat/completions");
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a concise assistant. Reply in one short sentence." },
          { role: "user", content: "Say hello in Chinese." },
        ],
        max_tokens: 64,
        temperature: 0.7,
      }),
    });
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    const text = await resp.text();
    const safeText = redactText(text, [key]);
    if (!resp.ok) {
      console.log(`  [${model}] → ${resp.status} in ${ms}s :: ${safeText.slice(0, 160)}`);
      return false;
    }
    let content = "";
    try {
      const json = JSON.parse(text) as {
        choices?: { message?: { content?: string } }[];
        error?: unknown;
      };
      if (json.error) {
        console.log(
          `  [${model}] → 200 but error body in ${ms}s :: ${redactText(JSON.stringify(json.error), [key]).slice(0, 160)}`,
        );
        return false;
      }
      content = json.choices?.[0]?.message?.content ?? "";
    } catch {
      console.log(`  [${model}] → 200 unparseable in ${ms}s :: ${safeText.slice(0, 160)}`);
      return false;
    }
    console.log(
      `  [${model}] ✓ OK in ${ms}s :: "${redactText(content, [key]).replace(/\s+/g, " ").slice(0, 80)}"`,
    );
    return true;
  } catch (e) {
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  [${model}] ✗ ERROR in ${ms}s :: ${redactText(String(e), [key]).slice(0, 160)}`);
    return false;
  }
}

async function main() {
  const key = process.env.RELAY_API_KEY;
  const base = process.env.RELAY_BASE_URL;
  if (!key || !base) {
    console.error("缺 RELAY_API_KEY / RELAY_BASE_URL");
    process.exit(1);
  }
  console.log(`base=${base} key=PRESENT\n`);
  const ids = await listModels(base, key);

  // 优先试 /models 里真的有的候选，再兜底全候选。
  const present = CANDIDATES.filter((c) => ids.includes(c));
  const toTry = present.length > 0 ? present : CANDIDATES;
  console.log(`\n试打 chat 候选（${present.length > 0 ? "命中 /models" : "盲试"}）：${toTry.join(", ")}`);
  const ok: string[] = [];
  for (const m of toTry) {
    if (await tryChat(base, key, m)) ok.push(m);
  }
  console.log(`\n可用 chat 模型：${ok.length > 0 ? ok.join(", ") : "（无）"}`);
  process.exit(ok.length > 0 ? 0 : 1);
}

main();
