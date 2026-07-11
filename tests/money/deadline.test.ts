import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteExpiredGenerationCredentials,
  encryptCustomApiKey,
} from "../../src/server/generation/credential.server";
import { expireDueGenerations } from "../../src/server/generation/deadline.server";
import { finalizeCustomSuccess } from "../../src/server/generation/finalizeCustom.server";
import { loadGenerationStatuses } from "../../src/server/generation/status.server";
import { chargeOnSuccess } from "../../src/server/money/debit.server";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
});
afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  await ctx.cleanup();
});

describe("generation deadline", () => {
  it("expires every in-flight state, writes one event, and deletes custom credentials", async () => {
    const userId = await ctx.createUser({ balanceMp: 100 });
    const jobs = await Promise.all(
      ["queued", "claimed", "running"].map((status) =>
        ctx.createGeneration(userId, { status, credentialMode: "custom", deadlineAgoSec: 1 }),
      ),
    );
    for (const job of jobs) {
      const sealed = encryptCustomApiKey(job.generationId, "fictional-timeout-value");
      await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                    VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,now()+interval '10 minutes')`;
    }

    expect(await expireDueGenerations({ userId, now: new Date() })).toHaveLength(3);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);
    expect(await ctx.events(userId, "image_failed")).toHaveLength(3);
    for (const job of jobs) expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect(await expireDueGenerations({ userId, now: new Date() })).toHaveLength(0);
  });

  it("status read closes only the requesting owner's jobs", async () => {
    const owner = await ctx.createUser();
    const other = await ctx.createUser();
    const ownJob = await ctx.createGeneration(owner, { deadlineAgoSec: 1 });
    const otherJob = await ctx.createGeneration(other, { deadlineAgoSec: 1 });
    const items = await loadGenerationStatuses(owner, [ownJob.generationId, otherJob.generationId]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      generationId: ownJob.generationId,
      status: "failed",
      errorCode: "provider_timeout",
    });
    expect((await ctx.gen(otherJob.generationId))?.status).toBe("queued");
  });

  it("deletes an expired credential without changing a fresh generation", async () => {
    const userId = await ctx.createUser();
    const job = await ctx.createGeneration(userId, { credentialMode: "custom" });
    const sealed = encryptCustomApiKey(job.generationId, "fictional-orphan-value");
    await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                  VALUES(${job.generationId},${sealed.ciphertext},${sealed.iv},${sealed.authTag},1,now()-interval '1 second')`;
    expect(await deleteExpiredGenerationCredentials(new Date())).toBe(1);
    expect(await ctx.credentials(job.generationId)).toHaveLength(0);
    expect((await ctx.gen(job.generationId))?.status).toBe("queued");
  });

  it("clamps duration when an abnormally old job is finally expired", async () => {
    const userId = await ctx.createUser();
    const job = await ctx.createGeneration(userId, {
      status: "running",
      deadlineAgoSec: 1,
    });
    await ctx.sql`UPDATE generations SET started_at=now()-interval '26 days'
                  WHERE id=${job.generationId}`;

    await expect(
      expireDueGenerations({ generationIds: [job.generationId], now: new Date() }),
    ).resolves.toHaveLength(1);
    expect(Number((await ctx.gen(job.generationId))?.duration_ms)).toBe(2_147_483_647);
  });

  it.each(["system", "custom"] as const)("allows exactly one terminal when %s success races timeout", async (mode) => {
    const userId = await ctx.createUser({ balanceMp: 10_000 });
    await ctx.addLot(userId, 10_000);
    const job = await ctx.createGeneration(userId, {
      status: "running",
      credentialMode: mode,
      deadlineAgoSec: 1,
    });
    const input = {
      generationId: job.generationId,
      userId,
      storageKey: `race/${job.generationId}.png`,
      publicUrl: `https://img.test/${job.generationId}.png`,
      contentType: "image/png",
      width: 1,
      height: 1,
      sizeBytes: 70,
    };
    const success = mode === "custom" ? finalizeCustomSuccess(input) : chargeOnSuccess(input);
    await Promise.allSettled([
      success,
      expireDueGenerations({ generationIds: [job.generationId], now: new Date() }),
    ]);
    const generation = await ctx.gen(job.generationId);
    expect(["succeeded", "failed"]).toContain(generation?.status);
    const images = await ctx.images(job.generationId);
    const debits = await ctx.ledger(userId, "debit");
    if (generation?.status === "failed") {
      expect(images).toHaveLength(0);
      expect(debits).toHaveLength(0);
    } else {
      expect(images).toHaveLength(1);
      expect(debits).toHaveLength(mode === "system" ? 1 : 0);
    }
    expect(
      (await ctx.events(userId, "image_succeeded")).length +
        (await ctx.events(userId, "image_failed")).length,
    ).toBe(1);
  });
});
