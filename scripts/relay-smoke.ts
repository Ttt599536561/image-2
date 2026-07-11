// 中转接真冒烟（④ 生图链路 de-risk）：callRelay 真生图 → putToR2 落 Supabase → fetch public_url → 删除。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/relay-smoke.ts
// ⚠️ 会真实消耗一次中转生图（铁律②：上线前实测成本对账）。只跑一张验证整链路。
import { randomUUID } from "node:crypto";
import { deleteFromR2, putToR2 } from "../src/server/r2.server";
import { callRelay } from "../src/server/relay";

async function main() {
  const prompt = "a simple red apple on a white table, clean product photo";
  const key = process.env.RELAY_API_KEY;
  console.log(`[relay-smoke] base=${process.env.RELAY_BASE_URL} key=${key ? "PRESENT" : "MISSING"}`);
  console.log(`prompt: "${prompt}"\n生图中（中转同步阻塞，可能数十秒~数分钟）…`);

  const t0 = Date.now();
  const { images } = await callRelay({
    prompt,
    size: "1024x1024",
    credential: { mode: "system" },
    deadlineAt: new Date(Date.now() + 5 * 60_000),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const kind = images[0]?.b64_json ? "b64_json" : images[0]?.url ? "url" : "?";
  console.log(`\ncallRelay ok in ${dt}s → images=${images.length}, first=${kind}`);
  if (!images.length) throw new Error("中转返回 0 张图");

  const userId = randomUUID();
  const genId = randomUUID();
  const put = await putToR2(userId, genId, images[0]);
  console.log(`putToR2 ok → ${put.width}x${put.height} ${put.sizeBytes}B ${put.contentType}`);
  console.log(`  publicUrl=${put.publicUrl}`);

  const resp = await fetch(put.publicUrl);
  const ct = resp.headers.get("content-type");
  console.log(`fetch public_url → ${resp.status} ${ct}`);
  const ok = resp.ok && (ct?.startsWith("image/") ?? false);

  await deleteFromR2(put.storageKey);
  console.log(`cleanup deleted`);
  console.log(`\n[relay-smoke] ${ok ? "PASS" : "FAIL"}（端到端 callRelay→putToR2→public_url，耗时 ${dt}s）`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  const he = e as { message?: string; httpStatus?: number };
  console.error(`[relay-smoke] FAIL: ${he?.message ?? e}`, he?.httpStatus ? `(http ${he.httpStatus})` : "");
  process.exit(1);
});
