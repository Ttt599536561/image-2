import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { closeDbPools, getPool } from "../../src/db/db.server";
import { subscribeGenerationChanges, type GenerationChange } from "../../src/server/generation/notifications.server";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { newCtx } from "./_helpers";

const ctx = newCtx();
const cleanups: Array<() => void> = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => { cleanups.splice(0).forEach((fn) => fn()); await ctx.cleanup(); });
afterAll(closeDbPools);

async function listen() {
  const changes: GenerationChange[] = [];
  let ready = false;
  cleanups.push(subscribeGenerationChanges((change) => changes.push(change), () => { ready = true; }));
  await vi.waitFor(() => expect(ready).toBe(true), { timeout: 2_000, interval: 10 });
  return changes;
}

describe("transactional generation notifications", () => {
  it("delivers only committed status changes, with IDs only, and never publishes a rollback", async () => {
    const userId = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(userId, { credentialMode: "custom" });
    const changes = await listen();
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE generations SET status='running' WHERE id=$1", [generationId]);
      await delay(50); expect(changes).toEqual([]);
      await client.query("COMMIT");
      await vi.waitFor(() => expect(changes).toEqual([{ generationId, userId }]), { timeout: 1_000, interval: 10 });
      await client.query("BEGIN");
      await client.query("UPDATE generations SET status='failed' WHERE id=$1", [generationId]);
      await client.query("ROLLBACK");
      await client.query("UPDATE generations SET status='running', prompt='no credential payload' WHERE id=$1", [generationId]);
      await delay(50); expect(changes).toHaveLength(1);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("notifies inserts and reads settled image metadata only for the owner", async () => {
    const userId = await ctx.createUser(); const foreignId = await ctx.createUser();
    const changes = await listen();
    const { generationId } = await ctx.createGeneration(userId, { credentialMode: "custom" });
    await vi.waitFor(() => expect(changes).toContainEqual({ generationId, userId }), { timeout: 1_000, interval: 10 });
    const client = await getPool().connect(); const imageId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO images(id,generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,saved_to_library) VALUES($1,$2,$3,'test/result','/media/result.png','image/png',1,1,68,false)", [imageId, generationId, userId]);
      await client.query("UPDATE generations SET status='succeeded', credits_charged_mp=0, duration_ms=123,completed_at=now() WHERE id=$1", [generationId]);
      await client.query("COMMIT");
      await vi.waitFor(() => expect(changes).toHaveLength(2), { timeout: 1_000, interval: 10 });
      expect(await loadGenerationStatuses(foreignId, [generationId])).toEqual([]);
      expect(await loadGenerationStatuses(userId, [generationId])).toMatchObject([{ status: "succeeded", image: { id: imageId, savedToLibrary: false, publicUrl: "/media/result.png" }, creditsChargedMp: 0 }]);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
