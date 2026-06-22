// 中转 /images/edits（图生图 multipart）探测（需求④a 前置，同 S6/#9 范式）。
// 目的：实测中转 api.tangguo.xin 的 gpt-image-2 是否支持 /images/edits（multipart 上传参考图 + prompt）。
//   - 200 + data[].b64_json/url → ✅ 支持 → 可进 ④b 图生图实装。
//   - 4xx/5xx（无渠道 503 / 不支持端点 / 模型不支持 edits）→ ❌ 不支持 → 阻塞，保持「参考图」disabled 占位。
// 自带极简 PNG 编码器造一张 512×512 渐变测试图（避免依赖外部图床/磁盘）。试标准 `image` 字段 + `image[]` 兜底。
// 跑：node --env-file=.env --import tsx scripts/relay-edits-probe.ts
import { deflateSync } from "node:zlib";
import { buildImageGenerationUrl } from "../src/api/imageGeneration";

// ---------- 极简 PNG 编码器（RGB、无 alpha、filter=0）----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, Buffer.from(data), crc]);
}
function makePng(size = 512): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  // 10/11/12 = compression/filter/interlace = 0
  const rowLen = size * 3;
  const raw = Buffer.alloc(size * (1 + rowLen));
  for (let y = 0; y < size; y++) {
    const off = y * (1 + rowLen);
    raw[off] = 0; // 每行 filter=none
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      raw[p] = Math.floor((x * 255) / size); // R 渐变
      raw[p + 1] = Math.floor((y * 255) / size); // G 渐变
      raw[p + 2] = 128; // B 常量（非纯色，避免被当空图）
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

const EDITS_TIMEOUT_MS = 180_000; // 图生图可能与文生图同量级耗时，留 3min 上限免无限挂起

type Outcome = "supported" | "unsupported" | "ambiguous";

async function probeEdits(
  base: string,
  key: string,
  png: Buffer,
  imageField: "image" | "image[]",
  extras?: { quality?: string; background?: string }, // 验证 edits 是否接受 quality/background（审查 #2）
): Promise<Outcome> {
  const url = buildImageGenerationUrl(base, "/images/edits");
  const fd = new FormData();
  fd.append("model", "gpt-image-2");
  fd.append("prompt", "change the background to a starry night sky, keep the composition");
  fd.append("size", "1024x1024");
  fd.append("n", "1");
  if (extras?.quality) fd.append("quality", extras.quality);
  if (extras?.background) fd.append("background", extras.background);
  // 不手动设 Content-Type：fetch 会按 FormData 自动加 multipart boundary。
  fd.append(imageField, new Blob([new Uint8Array(png)], { type: "image/png" }), "input.png");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EDITS_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    const text = await resp.text();
    if (!resp.ok) {
      console.log(`  [field=${imageField}] → ${resp.status} in ${ms}s :: ${text.slice(0, 260)}`);
      // 503「无可用渠道」/404/405 端点不存在 → 明确不支持；400 多为参数/字段问题（端点其实在）→ 含糊。
      if (resp.status === 400 || resp.status === 422) return "ambiguous";
      return "unsupported";
    }
    let json: { data?: { b64_json?: string; url?: string }[]; error?: unknown };
    try {
      json = JSON.parse(text);
    } catch {
      console.log(`  [field=${imageField}] → 200 unparseable in ${ms}s :: ${text.slice(0, 200)}`);
      return "ambiguous";
    }
    if (json.error && !json.data) {
      console.log(`  [field=${imageField}] → 200 但 error body in ${ms}s :: ${JSON.stringify(json.error).slice(0, 220)}`);
      return "unsupported";
    }
    const item = json.data?.[0];
    if (item?.b64_json) {
      const bytes = Buffer.from(item.b64_json, "base64");
      console.log(`  [field=${imageField}] ✓ 200 in ${ms}s :: 返回 b64_json ${bytes.length}B（图生图成功）`);
      return "supported";
    }
    if (item?.url) {
      console.log(`  [field=${imageField}] ✓ 200 in ${ms}s :: 返回 url ${item.url.slice(0, 80)}（图生图成功）`);
      return "supported";
    }
    console.log(`  [field=${imageField}] → 200 in ${ms}s 但无 data[0].b64_json/url :: ${text.slice(0, 200)}`);
    return "ambiguous";
  } catch (e) {
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    const isAbort = (e as { name?: string })?.name === "AbortError";
    console.log(`  [field=${imageField}] ✗ ${isAbort ? "超时" : "ERROR"} in ${ms}s :: ${String(e).slice(0, 200)}`);
    return isAbort ? "ambiguous" : "unsupported";
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const key = process.env.RELAY_API_KEY;
  const base = process.env.RELAY_BASE_URL;
  if (!key || !base) {
    console.error("缺 RELAY_API_KEY / RELAY_BASE_URL（见 .env / PHASE2-PLAN §0）");
    process.exit(2);
  }
  console.log(`base=${base} key=${key.slice(0, 6)}…(${key.length})`);
  const png = makePng(512);
  console.log(`测试图：512×512 RGB 渐变 PNG，${png.length}B\n`);
  console.log(`探 POST ${buildImageGenerationUrl(base, "/images/edits")}（multipart 图生图）：`);

  // 先试标准 `image` 字段；若含糊/不支持，再试 `image[]`（部分 One-API 网关按数组字段收 gpt-image 多图）。
  let outcome = await probeEdits(base, key, png, "image");
  if (outcome !== "supported") {
    console.log("  （标准 image 字段未成功，兜底再试 image[] 数组字段）");
    const alt = await probeEdits(base, key, png, "image[]");
    if (alt === "supported") outcome = "supported";
    else if (outcome === "unsupported" && alt === "ambiguous") outcome = "ambiguous";
  }

  // 审查 #2：验证 edits 是否接受 quality/background 字段（buildEditsForm 非 auto 档会发）。
  if (outcome === "supported") {
    console.log("\n附加：探 quality=high + background=opaque（审查 #2 验证 edits 接受非 auto 档）：");
    const withParams = await probeEdits(base, key, png, "image", {
      quality: "high",
      background: "opaque",
    });
    console.log(`quality/background on edits → ${withParams}`);
    if (withParams !== "supported") {
      console.log(
        "⚠️ edits 对 quality/background 不接受/含糊 → callRelay 图生图分支应不传这两字段（与本结果对齐）。",
      );
    } else {
      console.log("✅ edits 接受 quality/background → callRelay 可继续透传非 auto 档。");
    }
  }

  console.log(`\n结论：/images/edits（gpt-image-2 图生图）→ ${outcome}`);
  if (outcome === "supported") {
    console.log("✅ 中转支持图生图 → 可进入 ④b 实装（前端激活参考图上传 + callRelay 走 edits multipart）。");
    process.exit(0);
  } else if (outcome === "ambiguous") {
    console.log(
      "⚠️ 含糊（端点可能在、但参数/字段/格式被拒，或超时）。把上面原始响应给站长判读；" +
        "不要据此贸然实装，先据报错调字段/尺寸再复跑。",
    );
    process.exit(3);
  } else {
    console.log(
      "❌ 中转不支持 /images/edits（无渠道/端点不存在/模型不支持 edits）→ 阻塞 ④b，" +
        "Composer「参考图」保持 disabled 占位（同 S6/#9：中转开通后复跑本脚本再做）。",
    );
    process.exit(1);
  }
}

main();
