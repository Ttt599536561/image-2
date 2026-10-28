// ★server-only：对象存储（S3 兼容）。落地图 + 删除 + 不可枚举 key。
// 后端 = **Supabase Storage**（S3 协议；站长 2026-06-21 选定，替代原选型 Cloudflare R2——免自定义域/免绑卡，
//   公有桶自带公开 URL）。代码厂商中立：env 用 `STORAGE_*`（显式 endpoint），换 R2/B2/S3 只改值不改码。
// 文件名/函数名（r2.server / putToR2）为历史命名，保留以对齐规格稳定签名（03 §4.3 / 06 §7.3）。
// 真相源 06-storage.md §7.1–§7.5。前端永远只读 images.public_url（§7.6），绝不读中转临时 URL。
//
// 🔴 红线：存储凭据全在服务端 env，构建期断言不进 bundle（00 §1.4）；storage_key 末尾随机段是唯一软隔离；
//    落图在「扣费事务外」先做、结果存临时变量，再开扣费事务（03 §4.3 / 06 §7.3）。

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  deleteLocalStorageObject,
  deleteLocalStorageObjects,
  isLocalStorageEnabled,
  listLocalStorageObjects,
  localStoragePublicUrl,
  readLocalStorageObject,
  storageKeyFromLocalPublicUrl,
  writeLocalStorageObject,
} from "./local-storage.server";
import { MAX_IMAGE_BYTES, safeHttpsRequest } from "./studio/safe-http.server";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[storage] 缺少环境变量 ${name}（见 .env.example / deploy/.env.production.example）`);
  return v;
}

// 懒构造 + 缓存：离线 import / tsc 不触发 env 读取；容器进程内复用无状态 S3Client。
let _client: S3Client | null = null;
export function getR2Client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      // 显式 endpoint（厂商中立）：Supabase = https://<ref>.storage.supabase.co/storage/v1/s3；R2/B2 各自 endpoint。
      endpoint: env("STORAGE_S3_ENDPOINT"),
      region: process.env.STORAGE_S3_REGION || "auto", // Supabase 填项目 region；R2 用 auto
      forcePathStyle: true, // Supabase Storage（及多数非 AWS S3）走 path-style 寻址
      credentials: {
        accessKeyId: env("STORAGE_S3_ACCESS_KEY_ID"),
        secretAccessKey: env("STORAGE_S3_SECRET_ACCESS_KEY"),
      },
    });
  }
  return _client;
}

export interface PutResult {
  storageKey: string;
  publicUrl: string;
  contentType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
}

/** 中转返回（临时 URL 或 base64）→ 公有 URL（§7.2）。前端只读它。
 *  STORAGE_PUBLIC_BASE_URL：Supabase 公有桶 = https://<ref>.supabase.co/storage/v1/object/public/<bucket>（结尾不带 /）。 */
export function publicUrl(storageKey: string): string {
  if (isLocalStorageEnabled()) return localStoragePublicUrl(storageKey);
  return `${env("STORAGE_PUBLIC_BASE_URL")}/${storageKey}`;
}

/** 反 publicUrl：本桶公有 URL → storage key；非本桶（外链）→ null。用于从 cover_url 派生 cover_key。 */
export function storageKeyFromPublicUrl(url: string): string | null {
  if (isLocalStorageEnabled()) return storageKeyFromLocalPublicUrl(url);
  const base = process.env.STORAGE_PUBLIC_BASE_URL;
  if (!base) return null;
  const prefix = `${base.replace(/\/+$/, "")}/`;
  if (!url.startsWith(prefix)) return null;
  // 🔴 剥 query/fragment：S3 对象 key 物理上不含 ?#。若 admin 粘贴带 ?v=1 之类的本桶 URL，
  //    派生 key 必须与真实 key 对齐，否则孤儿清理 known-set 比对落空 → 误删在用封面（对抗审查 confirmed）。
  return url.slice(prefix.length).split("#")[0].split("?")[0];
}

/** 不可枚举 key（§7.2）：{userId}/{yyyy}/{mm}/{generationId}-{rand}.png。 */
export function buildStorageKey(userId: string, generationId: string, ext = "png"): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  // 6 字节 base64url 防枚举随机段，取前 8 位（§7.2）。
  const rand = randomBytes(6).toString("base64url").slice(0, 8);
  return `${userId}/${yyyy}/${mm}/${generationId}-${rand}.${ext}`;
}

async function putObject(key: string, body: Uint8Array, contentType: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (isLocalStorageEnabled()) {
    await writeLocalStorageObject(key, body, signal);
    return;
  }
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env("STORAGE_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable", // key 不可变 → 强缓存
    }),
    { abortSignal: signal },
  );
  signal?.throwIfAborted();
}

async function fetchImageBytes(relay: {
  b64_json?: string;
  url?: string;
}, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string }> {
  signal?.throwIfAborted();
  let bytes: Uint8Array;
  if (relay.b64_json) {
    const encoded = relay.b64_json;
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("provider image too large");
    if (encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("invalid provider image encoding");
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    if (Math.floor(encoded.length * 3 / 4) - padding > MAX_IMAGE_BYTES) throw new Error("provider image too large");
    bytes = Buffer.from(encoded, "base64");
  } else {
    if (!relay.url) throw new Error("provider image missing");
    // Signed image URL is separate from the authenticated generation request: never forward its key.
    const response = await safeHttpsRequest(relay.url, {
      signal, maxResponseBytes: MAX_IMAGE_BYTES, deadlineAtMs: Date.now() + 30_000,
    });
    if (response.status < 200 || response.status >= 300) throw new Error("provider image download failed");
    bytes = response.body;
  }
  signal?.throwIfAborted();
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("provider image too large");
  return { bytes, contentType: providerImageMime(bytes) };
}

/** Validate file signatures, never trust the URL suffix or upstream Content-Type. */
function providerImageMime(bytes: Uint8Array): string {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 24 && pngSignature.every((byte, index) => bytes[index] === byte) &&
    Buffer.from(bytes.subarray(12, 16)).toString("ascii") === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 20 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(Buffer.from(bytes.subarray(12, 16)).toString("ascii"))) return "image/webp";
  throw new Error("invalid provider image format");
}

/** 从 PNG 头读宽高（IHDR）；非 PNG / 解析失败返回 undefined（可选元数据）。 */
function readPngDims(bytes: Uint8Array): { width: number; height: number } | undefined {
  // PNG 签名 8 字节 + IHDR(len4+type4) → 宽高在偏移 16/20，big-endian uint32。
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * 落图到 R2（在扣费事务外调用，结果存临时变量，§7.3）。
 * relayImage = 中转返回的 {b64_json?,url?}，函数内部自取字节。
 */
export async function putToR2(
  userId: string,
  generationId: string,
  relayImage: { b64_json?: string; url?: string },
  signal?: AbortSignal,
): Promise<PutResult> {
  const { bytes, contentType } = await fetchImageBytes(relayImage, signal);
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  const storageKey = buildStorageKey(userId, generationId, extension);
  await putObject(storageKey, bytes, contentType, signal);
  signal?.throwIfAborted();
  const dims = readPngDims(bytes);
  return {
    storageKey,
    publicUrl: publicUrl(storageKey),
    contentType,
    width: dims?.width,
    height: dims?.height,
    sizeBytes: bytes.byteLength,
  };
}

/** 保留期（免费 7 / 付费 60，走全局参数，§7.4）。落 images.expires_at。 */
export function retentionExpiry(
  user: { has_paid: boolean },
  cfg: { freeDays: number; paidDays: number },
): Date {
  const days = user.has_paid ? cfg.paidDays : cfg.freeDays;
  return new Date(Date.now() + days * 86_400_000);
}

// ===================== ④b 图生图：参考图上传 + 回读 =====================
// 上传图存 `uploads/<userId>/…` 前缀（区别于成品图 `<userId>/…`）；userId 段供入队 owner-scope 校验。
// 「用后即弃」：不进 7/60 天保留期，靠孤儿清理 cron 回收（sweepOrphanR2Objects 的 known-set 保护「在途」未跑完的）。

/** 参考图上传 key：uploads/{userId}/{yyyy}/{mm}/{uuid}.{ext}。 */
export function buildUploadKey(userId: string, ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `uploads/${userId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

// ===================== 灵感库封面：管理员本地上传（永久，由灵感 CRUD 管理） =====================
// 存 `inspirations/{yyyy}/{mm}/{uuid}.{ext}`（不带 userId 段；非「用后即弃」）。
// 孤儿清理 cron 的 known-set UNION `inspirations.cover_key` 保护在用封面；删/换后的封面 cover_key 移除 → 孤儿回收。
export function buildInspirationCoverKey(ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `inspirations/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/** 落灵感封面。返回 {storageKey(cover_key), publicUrl(cover_url)}。 */
export async function putInspirationCover(args: {
  bytes: Uint8Array;
  contentType: string;
  ext: string;
}): Promise<{ storageKey: string; publicUrl: string }> {
  const storageKey = buildInspirationCoverKey(args.ext);
  await putObject(storageKey, args.bytes, args.contentType);
  return { storageKey, publicUrl: publicUrl(storageKey) };
}

// ===================== 首页画廊图片：管理员本地上传（永久，F-073，由 landing_gallery CRUD 管理） =====================
// 存 `landing/{yyyy}/{mm}/{uuid}.{ext}`（独立前缀，与灵感封面/用户图区分）。
// 孤儿清理 cron 的 known-set UNION `landing_gallery_items.image_key` 保护在用图；删/换后不再命中 → 孤儿回收。
export function buildLandingImageKey(ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `landing/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/** 落首页画廊图。返回 {storageKey(image_key), publicUrl(image_url)}。 */
export async function putLandingImage(args: {
  bytes: Uint8Array;
  contentType: string;
  ext: string;
}): Promise<{ storageKey: string; publicUrl: string }> {
  const storageKey = buildLandingImageKey(args.ext);
  await putObject(storageKey, args.bytes, args.contentType);
  return { storageKey, publicUrl: publicUrl(storageKey) };
}

// ===================== 灵感库用户投稿：副本（永久，§13.1） =====================
// 投稿即把用户作品复制一份到 `inspirations/submissions/<uid>/{yyyy}/{mm}/{uuid}.{ext}`（以 inspirations/ 开头 →
// deriveCoverKey 天然接受，通过后 inspirations.cover_key 复用同一对象）。pending 受孤儿 known-set 保护。
export function buildInspirationSubmissionKey(userId: string, ext: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `inspirations/submissions/${userId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/**
 * 把用户作品（srcKey）复制成投稿永久副本（厂商中立：GetObject 取字节 → PutObject 落新 key，
 * 不依赖 Supabase 是否支持 S3 CopyObject）。返回 {storageKey(image_key), publicUrl(image_url)}。
 */
export async function copyToInspirationSubmission(
  srcKey: string,
  userId: string,
): Promise<{ storageKey: string; publicUrl: string; contentType: string; bytes: number }> {
  if (isLocalStorageEnabled()) {
    const source = await readLocalStorageObject(srcKey);
    const ext = srcKey.split(".").pop()?.toLowerCase() || "png";
    const storageKey = buildInspirationSubmissionKey(userId, ext);
    await writeLocalStorageObject(storageKey, source.bytes);
    return {
      storageKey,
      publicUrl: publicUrl(storageKey),
      contentType: source.contentType,
      bytes: source.bytes.byteLength,
    };
  }
  const res = await getR2Client().send(
    new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: srcKey }),
  );
  if (!res.Body) throw new Error(`[storage] 投稿源对象为空：${srcKey}`);
  const body = new Uint8Array(await res.Body.transformToByteArray());
  const contentType = res.ContentType ?? "image/png";
  const ext = srcKey.split(".").pop()?.toLowerCase() || "png";
  const storageKey = buildInspirationSubmissionKey(userId, ext);
  await putObject(storageKey, body, contentType);
  return { storageKey, publicUrl: publicUrl(storageKey), contentType, bytes: body.byteLength };
}

/** 落用户上传的参考图（④b）。返回 {storageKey, publicUrl}。 */
export async function putUserUpload(args: {
  userId: string;
  bytes: Uint8Array;
  contentType: string;
  ext: string;
  signal?: AbortSignal;
}): Promise<{ storageKey: string; publicUrl: string }> {
  const storageKey = buildUploadKey(args.userId, args.ext);
  await putObject(storageKey, args.bytes, args.contentType, args.signal);
  return { storageKey, publicUrl: publicUrl(storageKey) };
}

/** Immutable session destination: recover only an already published identical object. */
export async function putUserUploadAtKey(args: {
  storageKey: string; bytes: Uint8Array; contentType: string; sha256: string; signal?: AbortSignal;
}): Promise<void> {
  args.signal?.throwIfAborted();
  if (createHash("sha256").update(args.bytes).digest("hex") !== args.sha256) throw new Error("upload digest mismatch");
  try {
    if (isLocalStorageEnabled()) {
      await writeLocalStorageObject(args.storageKey, args.bytes, args.signal);
    } else {
      await getR2Client().send(new PutObjectCommand({
        Bucket: env("STORAGE_BUCKET"), Key: args.storageKey, Body: args.bytes,
        ContentType: args.contentType, CacheControl: "private, no-store", IfNoneMatch: "*",
      }), { abortSignal: args.signal });
    }
  } catch (error) {
    const existing = error instanceof Error && (
      ("code" in error && error.code === "EEXIST") ||
      ("$metadata" in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)
    );
    if (!existing) throw error;
    const stored = await getStoredImageObject(args.storageKey, args.signal);
    if (stored.bytes.byteLength !== args.bytes.byteLength || createHash("sha256").update(stored.bytes).digest("hex") !== args.sha256) {
      throw new Error("stored upload conflict");
    }
  }
  args.signal?.throwIfAborted();
}

/** 服务端按已校验的 storage key 回读图片字节；不依赖公链，也不接受浏览器 URL。 */
export async function getStoredImageObject(
  storageKey: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  signal?.throwIfAborted();
  const maxStoredBytes = 64 * 1024 * 1024;
  if (isLocalStorageEnabled()) {
    const stored = await readLocalStorageObject(storageKey, signal);
    if (stored.bytes.byteLength > maxStoredBytes) throw new Error("stored image too large");
    return stored;
  }
  const res = await getR2Client().send(
    new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: storageKey }),
    { abortSignal: signal },
  );
  if (!res.Body) throw new Error(`[storage] 图片对象为空：${storageKey}`);
  // The SDK request may finish at headers; keep cancellation attached while its Node body streams.
  const body = res.Body;
  const abort = () => {
    if ("destroy" in body) body.destroy(new DOMException("storage read aborted", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  let bytes: Uint8Array;
  try {
    if (signal?.aborted) {
      // No body reader exists yet to handle an emitted stream error.
      if ("destroy" in body) body.destroy();
      signal.throwIfAborted();
    }
    if (res.ContentLength !== undefined && res.ContentLength > maxStoredBytes) {
      if ("destroy" in body) body.destroy();
      throw new Error("stored image too large");
    }
    if (Symbol.asyncIterator in body) {
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        signal?.throwIfAborted();
        received += chunk.byteLength;
        if (received > maxStoredBytes) throw new Error("stored image too large");
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks, received);
    } else {
      // Non-stream SDK adapters are retained for compatibility; Node S3 uses the bounded stream above.
      bytes = new Uint8Array(await body.transformToByteArray());
      if (bytes.byteLength > maxStoredBytes) throw new Error("stored image too large");
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return {
    bytes,
    contentType: res.ContentType ?? "image/png",
    filename: storageKey.split("/").pop() || "input.png",
  };
}

/** 回读临时上传参考图，保留既有调用签名。 */
export async function getUploadObject(
  storageKey: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  return getStoredImageObject(storageKey, signal);
}

/** 删单个对象（清理 cron 单 key 失败兜底，§7.5）。 */
export async function deleteFromR2(storageKey: string): Promise<void> {
  if (isLocalStorageEnabled()) {
    await deleteLocalStorageObject(storageKey);
    return;
  }
  await getR2Client().send(new DeleteObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: storageKey }));
}

/**
 * 批量删除（§7.5 过期图/孤儿清理）。自动分片 ≤1000/批（S3 DeleteObjects 硬上限）。
 * DeleteObjects 是「部分成功」API：返回 200 + 逐 key Errors[]、不抛错。返回未能删除的 key，
 * 供清理 cron 告警/不删对应 DB 行、下轮重扫（§7.5「catch 单 key 失败、记 event/告警」）。
 */
export async function deleteManyFromR2(storageKeys: string[]): Promise<string[]> {
  if (storageKeys.length === 0) return [];
  if (isLocalStorageEnabled()) return deleteLocalStorageObjects(storageKeys);
  const client = getR2Client();
  const bucket = env("STORAGE_BUCKET");
  const failed: string[] = [];
  for (let i = 0; i < storageKeys.length; i += 1000) {
    const chunk = storageKeys.slice(i, i + 1000);
    const res = await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })) } }),
    );
    for (const e of res.Errors ?? []) if (e.Key) failed.push(e.Key);
  }
  return failed;
}

export interface StorageObject {
  key: string;
  lastModified: number; // epoch ms（孤儿清理用 LastModified>1h 保护窗口，避开在途图，§7.5 B）
}

/**
 * 列出桶内对象（孤儿清理 cron 用，§7.5 B）。ListObjectsV2 续传分页；maxPages 上限防单次 cron 超时
 * （每页 ≤1000，默认上限 10 页=1万对象/轮，未尽部分下轮再扫）。返回 {key,lastModified(ms)}。
 */
export async function listStorageObjects(maxPages = 10): Promise<StorageObject[]> {
  if (isLocalStorageEnabled()) return listLocalStorageObjects();
  const client = getR2Client();
  const bucket = env("STORAGE_BUCKET");
  const out: StorageObject[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of res.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ? o.LastModified.getTime() : 0 });
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    token = res.NextContinuationToken;
  }
  return out;
}
