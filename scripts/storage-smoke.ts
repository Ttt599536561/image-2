// 存储接真冒烟（Supabase Storage，S3 兼容）：上传 → 取 public_url → fetch 验可访问 → 删除。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/storage-smoke.ts
// 验证 ① 地基里唯一挂着的「putToR2 往返」+ 公有桶公开 URL 是否打通。
import { randomUUID } from "node:crypto";
import {
  deleteFromR2,
  getUploadObject,
  putToR2,
  putUserUpload,
} from "../src/server/r2.server";

// 1x1 透明 PNG（含 IHDR，readPngDims 可解出 1x1）。
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main() {
  const userId = randomUUID();
  const genId = randomUUID();
  console.log(
    `[storage-smoke] endpoint=${process.env.STORAGE_S3_ENDPOINT}\n  bucket=${process.env.STORAGE_BUCKET} region=${process.env.STORAGE_S3_REGION}`,
  );

  // 1) 上传
  const put = await putToR2(userId, genId, { b64_json: PNG_1x1_B64 });
  console.log(`\nupload ok → storageKey=${put.storageKey}`);
  console.log(`  publicUrl=${put.publicUrl}`);
  console.log(`  dims=${put.width}x${put.height} bytes=${put.sizeBytes} ct=${put.contentType}`);

  // 2) fetch 公开 URL（公有桶应可匿名读到 image/*）
  const resp = await fetch(put.publicUrl);
  const ct = resp.headers.get("content-type");
  console.log(`\nfetch public_url → ${resp.status} ${ct}`);
  const okFetch = resp.ok && (ct?.startsWith("image/") ?? false);
  if (!okFetch) {
    const body = await resp.text().catch(() => "");
    console.error(`  ✗ 公开访问失败（桶是否 Public？STORAGE_PUBLIC_BASE_URL 是否对？）body=${body.slice(0, 200)}`);
  }

  // 3) 删除
  await deleteFromR2(put.storageKey);
  console.log(`\ndelete ok`);

  // 4) 删后再 fetch（best-effort，CDN 可能短暂缓存，不作硬断言）
  const resp2 = await fetch(put.publicUrl);
  console.log(`re-fetch after delete → ${resp2.status}（404/400 即已删；200 可能 CDN 缓存）`);

  // 5) ④b 参考图上传往返：putUserUpload → getUploadObject 字节一致 + key owner-scope 前缀 → 清理。
  const refBytes = new Uint8Array(Buffer.from(PNG_1x1_B64, "base64"));
  const up = await putUserUpload({ userId, bytes: refBytes, contentType: "image/png", ext: "png" });
  console.log(`\nputUserUpload → ${up.storageKey}`);
  const got = await getUploadObject(up.storageKey);
  const bytesMatch =
    got.bytes.length === refBytes.length && got.bytes.every((b, i) => b === refBytes[i]);
  const keyScoped = up.storageKey.startsWith(`uploads/${userId}/`);
  console.log(
    `getUploadObject → ${got.bytes.length}B ct=${got.contentType} 字节一致=${bytesMatch} owner前缀=${keyScoped}`,
  );
  await deleteFromR2(up.storageKey);
  console.log("upload 清理 ok");

  const pass = okFetch && bytesMatch && keyScoped;
  console.log(`\n[storage-smoke] ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("[storage-smoke] FAIL:", e);
  process.exit(1);
});
