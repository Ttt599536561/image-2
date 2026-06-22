// ④b 真·callRelay 图生图端到端冒烟：用「生产代码」callRelay({inputImage}) 实打中转 /images/edits。
// 与 relay-edits-probe 区别：probe 手搓 fetch 验端点；本脚本验「我们 buildEditsForm 的实际线格式 + 响应解析」
// 走通真中转。跑：node --env-file=.env --import tsx scripts/relay-edits-call-smoke.ts
import { deflateSync } from "node:zlib";
import { callRelay } from "../src/server/relay";

// —— 极简 PNG 编码器（RGB，造 256×256 渐变测试图）——
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, Buffer.from(data), crc]);
}
function makePng(size = 256): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowLen = size * 3;
  const raw = Buffer.alloc(size * (1 + rowLen));
  for (let y = 0; y < size; y++) {
    const off = y * (1 + rowLen);
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      raw[p] = Math.floor((x * 255) / size);
      raw[p + 1] = Math.floor((y * 255) / size);
      raw[p + 2] = 128;
    }
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  if (!process.env.RELAY_API_KEY || !process.env.RELAY_BASE_URL) {
    console.error("缺 RELAY_API_KEY / RELAY_BASE_URL");
    process.exit(2);
  }
  const png = makePng(256);
  console.log(`调 callRelay（图生图，inputImage ${png.length}B）…`);
  const t0 = Date.now();
  try {
    const { images } = await callRelay({
      prompt: "change the background to a calm starry night sky",
      size: "1024x1024",
      inputImage: { bytes: new Uint8Array(png), contentType: "image/png", filename: "ref.png" },
    });
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    const ok = images.length >= 1 && (!!images[0].b64_json || !!images[0].url);
    console.log(`callRelay → ${images.length} 张 in ${ms}s（${images[0]?.b64_json ? "b64" : images[0]?.url ? "url" : "无"}）`);
    console.log(`\n[relay-edits-call-smoke] ${ok ? "PASS" : "FAIL"}`);
    // 用 exitCode 而非 process.exit()：避免 undici keep-alive 套接字未关时 process.exit 触发 Windows libuv 断言。
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`callRelay 抛错 in ${ms}s :: ${String(e).slice(0, 300)}`);
    console.log("\n[relay-edits-call-smoke] FAIL");
    process.exitCode = 1;
  }
}

main();
