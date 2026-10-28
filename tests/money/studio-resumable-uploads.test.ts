import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newCtx, type TestCtx } from "./_helpers";
import * as storage from "../../src/server/r2.server";
import { createStudioUpload, writeStudioUploadChunk, completeStudioUpload, cleanupStudioUploads } from "../../src/server/studio/resumable-upload.server";
import { consumeStudioRate } from "../../src/server/studio/limits.server";

const CHUNK = 65536;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const input = (bytes = png) => ({ uploadId: randomUUID(), size: bytes.length, mime: "image/png" as const, sha256: digest(bytes) });
let ctx: TestCtx, owner: string;
const storedKeys = new Set<string>();
beforeEach(async () => { ctx = newCtx(); owner = await ctx.createUser(); });
afterEach(async () => { vi.restoreAllMocks(); for (const key of storedKeys) await storage.deleteFromR2(key); storedKeys.clear(); await ctx.cleanup(); });
async function ready(bytes = png, user = owner) {
  const metadata = input(bytes);
  await createStudioUpload(user, "127.0.0.1", metadata);
  for (let index = 0; index * CHUNK < bytes.length; index++) await writeStudioUploadChunk(user, metadata.uploadId, index, bytes.subarray(index * CHUNK, (index + 1) * CHUNK));
  return metadata;
}

describe("bounded resumable uploads on PostgreSQL", () => {
  it("replays a lost creation response without allocating another slot or changing its TTL", async () => {
    const metadata = input();
    const first = await createStudioUpload(owner, "127.0.0.1", metadata);
    const replay = await createStudioUpload(owner, "127.0.0.2", metadata);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ uploadId: metadata.uploadId, chunkSize: CHUNK, nextIndex: 0 });
    expect(await ctx.sql`SELECT id FROM studio_upload_sessions WHERE user_id=${owner}`).toHaveLength(1);
    await expect(createStudioUpload(owner, "127.0.0.1", { ...metadata, size: metadata.size + 1 })).rejects.toMatchObject({ status: 409 });
  });
  it("continues and completes a slow transfer after ten minutes without extending its absolute expiry", async () => {
    const metadata = input();
    const created = await createStudioUpload(owner, "127.0.0.1", metadata);
    // Advance the session's age without waiting in real time. Its original TTL remains unchanged.
    await ctx.sql`UPDATE studio_upload_sessions
      SET created_at=created_at-interval '10 minutes 1 second', expires_at=expires_at-interval '10 minutes 1 second'
      WHERE id=${metadata.uploadId}`;
    await expect(writeStudioUploadChunk(owner, metadata.uploadId, 0, png)).resolves.toEqual({ nextIndex: 1 });
    const replay = await createStudioUpload(owner, "127.0.0.1", metadata);
    expect(replay.expiresAt).toBe(new Date(Date.parse(created.expiresAt) - 601_000).toISOString());
    const result = await completeStudioUpload(owner, metadata.uploadId); storedKeys.add(result.inputImageKey);
    expect(digest((await storage.getUploadObject(result.inputImageKey)).bytes)).toBe(metadata.sha256);
  });
  it("serializes duplicate chunks, rejects conflict and gaps, and resumes at the first missing index", async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(CHUNK)]), metadata = input(bytes);
    await createStudioUpload(owner, "127.0.0.1", metadata);
    await expect(writeStudioUploadChunk(owner, metadata.uploadId, 1, bytes.subarray(CHUNK))).rejects.toMatchObject({ status: 409 });
    const result = await Promise.all([0, 1, 2].map(() => writeStudioUploadChunk(owner, metadata.uploadId, 0, bytes.subarray(0, CHUNK))));
    expect(result).toEqual([{ nextIndex: 1 }, { nextIndex: 1 }, { nextIndex: 1 }]);
    await expect(writeStudioUploadChunk(owner, metadata.uploadId, 0, Buffer.alloc(CHUNK))).rejects.toMatchObject({ status: 409 });
    await expect(writeStudioUploadChunk(owner, metadata.uploadId, 1, png.subarray(0, 1))).rejects.toMatchObject({ status: 400 });
    expect(await createStudioUpload(owner, "127.0.0.1", metadata)).toMatchObject({ nextIndex: 1 });
  });
  it("denies every foreign-owner operation without changing the upload", async () => {
    const metadata = await ready(), other = await ctx.createUser();
    await expect(createStudioUpload(other, "127.0.0.1", metadata)).rejects.toMatchObject({ status: 404 });
    await expect(writeStudioUploadChunk(other, metadata.uploadId, 0, png)).rejects.toMatchObject({ status: 404 });
    await expect(completeStudioUpload(other, metadata.uploadId)).rejects.toMatchObject({ status: 404 });
  });
  it("preserves all four MiB and replays completion after lost response", async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024 - png.length, 127)]), metadata = await ready(bytes);
    const result = await completeStudioUpload(owner, metadata.uploadId); storedKeys.add(result.inputImageKey);
    expect(digest((await storage.getUploadObject(result.inputImageKey)).bytes)).toBe(metadata.sha256);
    expect(await completeStudioUpload(owner, metadata.uploadId)).toEqual(result);
    expect(await createStudioUpload(owner, "127.0.0.1", metadata)).toMatchObject({ inputImageKey: result.inputImageKey, nextIndex: 64 });
    expect(await ctx.sql`SELECT upload_id FROM studio_upload_chunks WHERE upload_id=${metadata.uploadId}`).toHaveLength(0);
    expect((await ctx.sql`SELECT status FROM studio_upload_sessions WHERE id=${metadata.uploadId}`)[0].status).toBe("complete");
  });
  it("recovers if storage succeeded but its acknowledgement was lost before the DB receipt", async () => {
    const metadata = await ready();
    const original = storage.putUserUploadAtKey;
    vi.spyOn(storage, "putUserUploadAtKey").mockImplementationOnce(async (args) => { await original(args); storedKeys.add(args.storageKey); throw new Error("lost storage acknowledgement"); });
    await expect(completeStudioUpload(owner, metadata.uploadId)).rejects.toThrow("lost storage acknowledgement");
    const result = await completeStudioUpload(owner, metadata.uploadId);
    expect(storedKeys.has(result.inputImageKey)).toBe(true);
    expect(Buffer.from((await storage.getUploadObject(result.inputImageKey)).bytes)).toEqual(png);
  });
  it("concurrent completion converges on one immutable object", async () => {
    const metadata = await ready();
    const results = await Promise.allSettled([0, 1, 2].map(() => completeStudioUpload(owner, metadata.uploadId)));
    const success = results.find((r) => r.status === "fulfilled");
    expect(success?.status).toBe("fulfilled");
    if (success?.status !== "fulfilled") throw new Error("no completion");
    storedKeys.add(success.value.inputImageKey);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ status: 503 });
      else expect(result.value).toEqual(success.value);
    }
    expect(await completeStudioUpload(owner, metadata.uploadId)).toEqual(success.value);
  });
  it("validates hash, declared MIME and missing chunks before final storage", async () => {
    const metadata = input();
    await createStudioUpload(owner, "127.0.0.1", { ...metadata, sha256: "0".repeat(64) });
    await expect(completeStudioUpload(owner, metadata.uploadId)).rejects.toMatchObject({ status: 409 });
    await writeStudioUploadChunk(owner, metadata.uploadId, 0, png);
    await expect(completeStudioUpload(owner, metadata.uploadId)).rejects.toMatchObject({ status: 400 });
    const wrong = { ...input(), mime: "image/jpeg" as const };
    await createStudioUpload(owner, "127.0.0.1", wrong); await writeStudioUploadChunk(owner, wrong.uploadId, 0, png);
    await expect(completeStudioUpload(owner, wrong.uploadId)).rejects.toMatchObject({ status: 400 });
  });
  it("enforces owner capacity atomically including expired but uncleared payload", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createStudioUpload(owner, "127.0.0.1", input())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((r) => r.status === "rejected").every((r) => r.status === "rejected" && r.reason.status === 429)).toBe(true);
    await ctx.sql`UPDATE studio_upload_sessions SET expires_at=now()-interval '1 second' WHERE user_id=${owner}`;
    await expect(createStudioUpload(owner, "127.0.0.1", input())).rejects.toMatchObject({ status: 429 });
    expect(await cleanupStudioUploads()).toBe(4);
    await expect(createStudioUpload(owner, "127.0.0.1", input())).resolves.toMatchObject({ nextIndex: 0 });
  });
  it("enforces IP and global capacity across owners", async () => {
    const owners = await Promise.all(Array.from({ length: 11 }, () => ctx.createUser()));
    for (const user of owners.slice(0, 2)) for (let n = 0; n < 4; n++) await createStudioUpload(user, "shared-ip", input());
    await expect(createStudioUpload(owners[2], "shared-ip", input())).rejects.toMatchObject({ status: 429 });
    for (const [i, user] of owners.slice(2, 10).entries()) for (let n = 0; n < 4; n++) await createStudioUpload(user, `ip-${i}`, input());
    await expect(createStudioUpload(owners[10], "extra-ip", input())).rejects.toMatchObject({ status: 429 });
  });
  it("expires all operations and physically clears chunk data", async () => {
    const metadata = await ready();
    await ctx.sql`UPDATE studio_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=${metadata.uploadId}`;
    for (const operation of [() => createStudioUpload(owner, "127.0.0.1", metadata), () => writeStudioUploadChunk(owner, metadata.uploadId, 0, png), () => completeStudioUpload(owner, metadata.uploadId)]) await expect(operation()).rejects.toMatchObject({ status: 410 });
    expect(await cleanupStudioUploads()).toBe(1);
    expect(await ctx.sql`SELECT upload_id FROM studio_upload_chunks WHERE upload_id=${metadata.uploadId}`).toHaveLength(0);
  });
  it("cleanup cannot remove a finalization while bounded storage IO is in progress, and IO holds no quota lock", async () => {
    const metadata = await ready();
    const original = storage.putUserUploadAtKey;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(storage, "putUserUploadAtKey").mockImplementationOnce(async (args) => { entered(); await gate; await original(args); });
    const finalization = completeStudioUpload(owner, metadata.uploadId); await started;
    await ctx.sql`UPDATE studio_upload_sessions SET expires_at=now()-interval '1 second' WHERE id=${metadata.uploadId}`;
    try {
      expect(await cleanupStudioUploads()).toBe(0);
      await expect(createStudioUpload(owner, "127.0.0.1", input())).resolves.toMatchObject({ nextIndex: 0 });
    } finally { release(); }
    const result = await finalization; storedKeys.add(result.inputImageKey);
    expect(await cleanupStudioUploads()).toBe(1);
  });
  it.each([false, true])("fences old finalization and lease-release after another operation reclaims the lease (old IO fails=%s)", async (failOld) => {
    const metadata = await ready(), original = storage.putUserUploadAtKey;
    const gates = [0, 1].map(() => { let release!: () => void, entered!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; }); return { release, entered, wait, started }; });
    let call = 0;
    vi.spyOn(storage, "putUserUploadAtKey").mockImplementation(async (args) => {
      const index = call++; gates[index].entered(); await gates[index].wait;
      if (index === 0 && failOld) throw new Error("old storage failure");
      await original(args); storedKeys.add(args.storageKey);
    });
    const old = completeStudioUpload(owner, metadata.uploadId).then((value) => ({ value }), (error: unknown) => ({ error }));
    await gates[0].started;
    await ctx.sql`UPDATE studio_upload_sessions SET finalizing_until=now()-interval '1 second' WHERE id=${metadata.uploadId}`;
    const fresh = completeStudioUpload(owner, metadata.uploadId); await gates[1].started;
    const token = (await ctx.sql`SELECT finalization_token FROM studio_upload_sessions WHERE id=${metadata.uploadId}`)[0].finalization_token;
    gates[0].release(); const oldResult = await old;
    expect(oldResult).toHaveProperty("error");
    expect((await ctx.sql`SELECT finalization_token FROM studio_upload_sessions WHERE id=${metadata.uploadId}`)[0].finalization_token).toBe(token);
    gates[1].release(); expect((await fresh).inputImageKey).toBe([...storedKeys][0]);
  });
  it("limits assembly and storage to four concurrent finalizations across owners", async () => {
    const other = await ctx.createUser();
    const uploads = await Promise.all([0, 1, 2, 3].map(() => ready())); const extra = await ready(png, other);
    const original = storage.putUserUploadAtKey;
    let release!: () => void, entered!: () => void, count = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(storage, "putUserUploadAtKey").mockImplementation(async (args) => { if (++count === 4) entered(); await gate; await original(args); storedKeys.add(args.storageKey); });
    const active = uploads.map((u) => completeStudioUpload(owner, u.uploadId)); await started;
    try { await expect(completeStudioUpload(other, extra.uploadId)).rejects.toMatchObject({ status: 503 }); expect(count).toBe(4); }
    finally { release(); }
    await Promise.all(active);
    await completeStudioUpload(other, extra.uploadId); expect(count).toBe(5);
  });
  it("allows three attempts for all chunks of four maximum-size files with separate per-upload budget", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const request = new Request("https://studio.example", { headers: { "x-studio-client-ip": "198.51.100.241" } });
    const firstWindow = Math.floor(Date.now() / 600_000);
    try {
      for (const uploadId of ids) for (let i = 0; i < 64 * 3; i++) await consumeStudioRate(request, "upload-chunk", owner, { uploadId });
      for (let i = 192; i < 256; i++) await consumeStudioRate(request, "upload-chunk", owner, { uploadId: ids[0] });
      await expect(consumeStudioRate(request, "upload-chunk", owner, { uploadId: ids[0] })).rejects.toMatchObject({ status: 429 });
      // Independent original upload budget remains untouched.
      await expect(consumeStudioRate(request, "upload", owner)).resolves.toBeUndefined();
    } finally {
      const hashes: string[] = [];
      for (let window = firstWindow; window <= Math.floor(Date.now() / 600_000); window++) {
        for (const scope of ["upload", "upload-chunk"]) for (const identity of [`ip:198.51.100.241`, `owner:${owner}`, ...ids.map((id) => `upload:${owner}:${id}`)]) hashes.push(createHash("sha256").update(`${scope}:${window}:${identity}`).digest("hex"));
      }
      await ctx.sql`DELETE FROM studio_rate_limits WHERE bucket_hash=ANY(${hashes}::text[])`;
    }
  });
});
