import { createHash, randomUUID } from "node:crypto";
import { httpError } from "../../contracts/error";
import { STUDIO_UPLOAD_CHUNK_BYTES, STUDIO_UPLOAD_TTL_MS, StudioUploadCreateRequest, type StudioUploadSession, type StudioUploadChunkResult, type StudioUploadCompleteResult } from "../../contracts/studio-upload";
import { UPLOAD_EXT, sniffImageMime, type UploadMime } from "../../contracts/upload";
import { buildUploadKey, putUserUploadAtKey } from "../r2.server";
import { tx, type TxClient } from "../tx.server";

const CAPACITY_LOCK = 37479011;
const FINALIZATION_LOCK = 37479012;
const FINALIZATION_LEASE_MS = 45_000;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type UploadRow = {
  id: string; user_id: string; size_bytes: number; mime: UploadMime; sha256: string; storage_key: string;
  status: "receiving" | "finalizing" | "complete"; next_index: number; expires_at: Date | string;
  finalization_token: string | null; lease_live: boolean; expired: boolean;
};
function expired(): Response { return httpError(410, "UPLOAD_EXPIRED", "上传已过期，请重新上传参考图"); }
function busy(): Response {
  const response = httpError(503, "UPLOAD_BUSY", "图片正在保存，请稍后重试");
  response.headers.set("Retry-After", "2");
  return response;
}
function assertOwner(row: UploadRow | undefined, owner: string): asserts row is UploadRow {
  if (!row) throw expired();
  if (row.user_id !== owner) throw httpError(404, "NOT_FOUND", "上传不存在");
  if (row.expired) throw expired();
}
async function lockedUpload(client: TxClient, id: string): Promise<UploadRow | undefined> {
  return (await client.query<UploadRow>(`SELECT *, expires_at<=clock_timestamp() AS expired,
    COALESCE(finalizing_until>clock_timestamp(),false) AS lease_live
    FROM studio_upload_sessions WHERE id=$1 FOR UPDATE`, [id])).rows[0];
}
function session(row: UploadRow): StudioUploadSession {
  return { uploadId: row.id, chunkSize: STUDIO_UPLOAD_CHUNK_BYTES, nextIndex: row.next_index,
    expiresAt: new Date(row.expires_at).toISOString(), ...(row.status === "complete" ? { inputImageKey: row.storage_key } : {}) };
}
export async function createStudioUpload(owner: string, ip: string, input: StudioUploadCreateRequest): Promise<StudioUploadSession> {
  if (!StudioUploadCreateRequest.safeParse(input).success) throw httpError(400, "INVALID_PARAM", "上传参数无效");
  return tx(async (client) => {
    // Expired payload still counts until physical cleanup. Storage IO never holds this lock.
    await client.query("SELECT pg_advisory_xact_lock($1)", [CAPACITY_LOCK]);
    const existing = await lockedUpload(client, input.uploadId);
    if (existing) {
      assertOwner(existing, owner);
      if (existing.size_bytes !== input.size || existing.mime !== input.mime || existing.sha256 !== input.sha256) throw httpError(409, "UPLOAD_CONFLICT", "上传参数与已有文件不一致");
      return session(existing);
    }
    const ipHash = sha256(ip);
    const counts = (await client.query<{ total: number; owner: number; ip: number }>(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE user_id=$1)::int AS owner, count(*) FILTER (WHERE ip_hash=$2)::int AS ip
      FROM studio_upload_sessions WHERE status<>'complete'`, [owner, ipHash])).rows[0];
    if (counts.total >= 40 || counts.owner >= 4 || counts.ip >= 8) {
      const response = httpError(429, "UPLOAD_CAPACITY", "正在上传的图片较多，请稍后重试");
      response.headers.set("Retry-After", "5"); throw response;
    }
    const result = await client.query<UploadRow>(`INSERT INTO studio_upload_sessions
      (id,user_id,ip_hash,size_bytes,mime,sha256,storage_key,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8 * interval '1 millisecond') RETURNING *`,
      [input.uploadId, owner, ipHash, input.size, input.mime, input.sha256, buildUploadKey(owner, UPLOAD_EXT[input.mime]), STUDIO_UPLOAD_TTL_MS]);
    return session(result.rows[0]);
  });
}
export async function writeStudioUploadChunk(owner: string, id: string, index: number, bytes: Uint8Array): Promise<StudioUploadChunkResult> {
  if (!Number.isInteger(index) || index < 0 || index >= 64 || !bytes.byteLength || bytes.byteLength > STUDIO_UPLOAD_CHUNK_BYTES) throw httpError(400, "INVALID_PARAM", "分片参数无效");
  return tx(async (client) => {
    const row = await lockedUpload(client, id); assertOwner(row, owner);
    const expected = Math.min(STUDIO_UPLOAD_CHUNK_BYTES, row.size_bytes - index * STUDIO_UPLOAD_CHUNK_BYTES);
    if (expected <= 0 || bytes.byteLength !== expected) throw httpError(400, "INVALID_PARAM", "分片长度无效");
    const hash = sha256(bytes);
    if (index < row.next_index && row.status !== "complete") {
      const prior = (await client.query<{ sha256: string }>("SELECT sha256 FROM studio_upload_chunks WHERE upload_id=$1 AND chunk_index=$2", [id, index])).rows[0];
      if (prior?.sha256 !== hash) throw httpError(409, "UPLOAD_CONFLICT", "分片内容冲突");
      return { nextIndex: row.next_index };
    }
    if (row.status !== "receiving" || index !== row.next_index) throw httpError(409, "UPLOAD_CONFLICT", "分片顺序或上传状态无效");
    await client.query("INSERT INTO studio_upload_chunks(upload_id,chunk_index,bytes,sha256) VALUES($1,$2,$3,$4)", [id, index, Buffer.from(bytes), hash]);
    await client.query("UPDATE studio_upload_sessions SET next_index=next_index+1 WHERE id=$1", [id]);
    return { nextIndex: index + 1 };
  });
}
export async function completeStudioUpload(owner: string, id: string, signal?: AbortSignal): Promise<StudioUploadCompleteResult> {
  signal?.throwIfAborted();
  const prepared = await tx(async (client) => {
    // Bound assembly memory across processes; release all DB locks before storage IO.
    await client.query("SELECT pg_advisory_xact_lock($1)", [FINALIZATION_LOCK]);
    const row = await lockedUpload(client, id); assertOwner(row, owner);
    if (row.status === "complete") return { row, token: null, bytes: null };
    if (row.lease_live) throw busy();
    if (row.next_index !== Math.ceil(row.size_bytes / STUDIO_UPLOAD_CHUNK_BYTES)) throw httpError(409, "UPLOAD_INCOMPLETE", "参考图尚未上传完成");
    const active = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM studio_upload_sessions WHERE finalizing_until>clock_timestamp() AND status='finalizing'")).rows[0].count;
    if (active >= 4) throw busy();
    const chunks = (await client.query<{ bytes: Buffer; chunk_index: number }>("SELECT bytes,chunk_index FROM studio_upload_chunks WHERE upload_id=$1 ORDER BY chunk_index", [id])).rows;
    if (chunks.length !== row.next_index || chunks.some((chunk, index) => chunk.chunk_index !== index)) throw httpError(409, "UPLOAD_INCOMPLETE", "参考图尚未上传完成");
    const bytes = Buffer.concat(chunks.map((chunk) => chunk.bytes));
    const mime = sniffImageMime(bytes);
    const fullPng = mime !== "image/png" || [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
    if (bytes.byteLength !== row.size_bytes || sha256(bytes) !== row.sha256 || mime !== row.mime || !fullPng) throw httpError(400, "INVALID_UPLOAD", "参考图长度、摘要或图片格式无效");
    const token = randomUUID();
    await client.query(`UPDATE studio_upload_sessions SET status='finalizing',finalization_token=$2,
      finalizing_until=clock_timestamp()+$3 * interval '1 millisecond' WHERE id=$1`, [id, token, FINALIZATION_LEASE_MS]);
    return { row, token, bytes };
  });
  const { row, token, bytes } = prepared;
  if (!token || !bytes) return { inputImageKey: row.storage_key };
  const storageSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  try {
    await putUserUploadAtKey({ storageKey: row.storage_key, bytes, contentType: row.mime, sha256: row.sha256, signal: storageSignal });
    return await tx(async (client) => {
      const current = await lockedUpload(client, id);
      // A late finalizer cannot acknowledge a recreated session that happens to reuse its UUID.
      if (!current || current.user_id !== owner || current.storage_key !== row.storage_key || current.finalization_token !== token || !current.lease_live) throw expired();
      await client.query("DELETE FROM studio_upload_chunks WHERE upload_id=$1", [id]);
      await client.query("UPDATE studio_upload_sessions SET status='complete',finalizing_until=NULL,finalization_token=NULL WHERE id=$1", [id]);
      return { inputImageKey: row.storage_key };
    });
  } catch (error) {
    // Preserve finalizing bytes/key for recovery; release only the failed operation's lease.
    try { await tx(async (client) => { await client.query("UPDATE studio_upload_sessions SET finalizing_until=NULL,finalization_token=NULL WHERE id=$1 AND finalization_token=$2 AND storage_key=$3", [id, token, row.storage_key]); }); } catch { /* DB outage recovers when lease expires */ }
    throw error;
  }
}
export async function cleanupStudioUploads(): Promise<number> {
  return tx(async (client) => {
    const result = await client.query(`WITH expired AS (
      SELECT id FROM studio_upload_sessions WHERE expires_at<=clock_timestamp()
        AND (finalizing_until IS NULL OR finalizing_until<=clock_timestamp())
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
    ) DELETE FROM studio_upload_sessions s USING expired WHERE s.id=expired.id`);
    return result.rowCount ?? 0;
  });
}
