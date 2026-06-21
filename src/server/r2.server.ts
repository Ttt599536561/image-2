// ★server-only：对象存储（S3 兼容）。落地图 + 删除 + 不可枚举 key。
// 后端 = **Supabase Storage**（S3 协议；站长 2026-06-21 选定，替代原选型 Cloudflare R2——免自定义域/免绑卡，
//   公有桶自带公开 URL）。代码厂商中立：env 用 `STORAGE_*`（显式 endpoint），换 R2/B2/S3 只改值不改码。
// 文件名/函数名（r2.server / putToR2）为历史命名，保留以对齐规格稳定签名（03 §4.3 / 06 §7.3）。
// 真相源 06-storage.md §7.1–§7.5。前端永远只读 images.public_url（§7.6），绝不读中转临时 URL。
//
// 🔴 红线：存储凭据全在服务端 env，构建期断言不进 bundle（00 §1.4）；storage_key 末尾随机段是唯一软隔离；
//    落图在「扣费事务外」先做、结果存临时变量，再开扣费事务（03 §4.3 / 06 §7.3）。

import { randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[storage] 缺少环境变量 ${name}（接真存储前需配置，见 PHASE2-PLAN §0）`);
  return v;
}

// 懒构造 + 缓存：离线 import / tsc 不触发 env 读取；serverless 内 S3Client 无状态可跨请求复用。
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
  return `${env("STORAGE_PUBLIC_BASE_URL")}/${storageKey}`;
}

/** 不可枚举 key（§7.2）：{userId}/{yyyy}/{mm}/{generationId}-{rand}.png。 */
export function buildStorageKey(userId: string, generationId: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  // 6 字节 base64url 防枚举随机段，取前 8 位（§7.2）。
  const rand = randomBytes(6).toString("base64url").slice(0, 8);
  return `${userId}/${yyyy}/${mm}/${generationId}-${rand}.png`;
}

async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env("STORAGE_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable", // key 不可变 → 强缓存
    }),
  );
}

async function fetchImageBytes(relay: {
  b64_json?: string;
  url?: string;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (relay.b64_json) {
    return { bytes: new Uint8Array(Buffer.from(relay.b64_json, "base64")), contentType: "image/png" };
  }
  if (!relay.url) throw new Error("relay image: 缺少 b64_json / url");
  // 临时 URL：必须在中转链路活着时立刻取字节，绝不把它存进 DB（§7.6）。
  const resp = await fetch(relay.url);
  if (!resp.ok) throw new Error(`relay image fetch ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, contentType: resp.headers.get("content-type") ?? "image/png" };
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
): Promise<PutResult> {
  const { bytes, contentType } = await fetchImageBytes(relayImage);
  const storageKey = buildStorageKey(userId, generationId);
  await putObject(storageKey, bytes, contentType);
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

/** 删单个对象（清理 cron 单 key 失败兜底，§7.5）。 */
export async function deleteFromR2(storageKey: string): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: storageKey }));
}

/**
 * 批量删除（§7.5 过期图/孤儿清理）。自动分片 ≤1000/批（S3 DeleteObjects 硬上限）。
 * DeleteObjects 是「部分成功」API：返回 200 + 逐 key Errors[]、不抛错。返回未能删除的 key，
 * 供清理 cron 告警/不删对应 DB 行、下轮重扫（§7.5「catch 单 key 失败、记 event/告警」）。
 */
export async function deleteManyFromR2(storageKeys: string[]): Promise<string[]> {
  if (storageKeys.length === 0) return [];
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
