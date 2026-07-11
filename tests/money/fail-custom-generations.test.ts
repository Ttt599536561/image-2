import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLY_CONFIRMATION,
  OPERATIONAL_FAILURE_MESSAGE,
  parseFailCustomGenerationArgs,
  runFailCustomGenerations,
} from "../../scripts/fail-custom-generations";
import { getPool } from "../../src/db/db.server";
import { type TestCtx, newCtx } from "./_helpers";

const originalCustomModesFlag = process.env.CUSTOM_KEY_MODES_ENABLED;
let ctx: TestCtx;

beforeEach(() => {
  process.env.CUSTOM_KEY_MODES_ENABLED = "false";
  ctx = newCtx();
});

afterEach(async () => {
  if (originalCustomModesFlag === undefined) delete process.env.CUSTOM_KEY_MODES_ENABLED;
  else process.env.CUSTOM_KEY_MODES_ENABLED = originalCustomModesFlag;
  await ctx.cleanup();
});

async function addOpaqueCredential(generationId: string): Promise<void> {
  await ctx.sql`INSERT INTO generation_credentials(generation_id,ciphertext,iv,auth_tag,key_version,expires_at)
                VALUES(${generationId},'opaque-fixture','fixture-iv','fixture-tag',1,now()+interval '10 minutes')`;
}

async function credentialCount(generationIds: string[]): Promise<number> {
  const rows = await ctx.sql`SELECT count(*)::int AS n
                             FROM generation_credentials
                             WHERE generation_id=ANY(${generationIds}::uuid[])`;
  return Number(rows[0]?.n ?? 0);
}

describe("fail custom generations arguments", () => {
  it("parses dry-run and the exact apply confirmation", () => {
    const adminId = randomUUID();
    expect(parseFailCustomGenerationArgs(["--admin-id", adminId, "--reason", " rollback audit "])).toEqual({
      adminId,
      reason: "rollback audit",
      apply: false,
    });
    expect(
      parseFailCustomGenerationArgs([
        "--admin-id",
        adminId,
        "--reason",
        "containment",
        "--apply",
        "--confirm",
        APPLY_CONFIRMATION,
      ]),
    ).toEqual({ adminId, reason: "containment", apply: true, confirmation: APPLY_CONFIRMATION });
  });

  it.each([
    [["--reason", "audit"], "--admin-id"],
    [["--admin-id", "not-a-uuid", "--reason", "audit"], "valid UUID"],
    [["--admin-id", randomUUID(), "--reason", "   "], "non-empty"],
    [["--admin-id", randomUUID(), "--reason", "audit", "--apply"], "exact confirmation"],
    [["--admin-id", randomUUID(), "--reason", "audit", "--confirm", APPLY_CONFIRMATION], "requires --apply"],
    [["--admin-id", randomUUID(), "--reason", "audit", "--unexpected"], "unknown argument"],
  ])("rejects invalid arguments without opening a database connection", (args, message) => {
    expect(() => parseFailCustomGenerationArgs(args)).toThrow(message);
  });
});

describe("fail custom generations operation", () => {
  it("refuses while custom submissions are enabled before creating a pool", async () => {
    process.env.CUSTOM_KEY_MODES_ENABLED = "true";
    const createPool = vi.fn(() => {
      throw new Error("pool must not be created");
    });

    await expect(
      runFailCustomGenerations(
        { adminId: randomUUID(), reason: "audit", apply: false },
        { createPool },
      ),
    ).rejects.toThrow("disable CUSTOM_KEY_MODES_ENABLED first");
    expect(createPool).not.toHaveBeenCalled();
  });

  it("rechecks the apply confirmation before creating a pool", async () => {
    const createPool = vi.fn(() => {
      throw new Error("pool must not be created");
    });

    await expect(
      runFailCustomGenerations(
        { adminId: randomUUID(), reason: "audit", apply: true },
        { createPool },
      ),
    ).rejects.toThrow("exact confirmation");
    expect(createPool).not.toHaveBeenCalled();
  });

  it("closes a one-shot pool when connecting fails", async () => {
    const end = vi.fn(async () => undefined);
    const createPool = () => ({
      connect: async () => {
        throw new Error("connect failed");
      },
      end,
    });

    await expect(
      runFailCustomGenerations(
        { adminId: randomUUID(), reason: "audit", apply: false },
        { createPool, log: () => undefined },
      ),
    ).rejects.toThrow("connect failed");
    expect(end).toHaveBeenCalledOnce();
  });

  it("defaults to a count-only dry-run with zero writes", async () => {
    const adminId = await ctx.createUser();
    const userId = await ctx.createUser();
    const queued = await ctx.createGeneration(userId, { status: "queued", credentialMode: "custom" });
    const secondQueued = await ctx.createGeneration(userId, { status: "queued", credentialMode: "custom" });
    const running = await ctx.createGeneration(userId, { status: "running", credentialMode: "custom" });
    const terminal = await ctx.createGeneration(userId, { status: "succeeded", credentialMode: "custom" });
    const system = await ctx.createGeneration(userId, { status: "queued", credentialMode: "system" });
    await addOpaqueCredential(queued.generationId);
    await addOpaqueCredential(secondQueued.generationId);
    await addOpaqueCredential(running.generationId);
    const output: string[] = [];

    const result = await runFailCustomGenerations(
      { adminId, reason: "dry-run reason must not be logged", apply: false },
      { log: (line) => output.push(line) },
    );

    expect(result).toEqual({
      mode: "dry-run",
      total: 3,
      statuses: { queued: 2, claimed: 0, running: 1 },
    });
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(result);
    expect(Object.keys(JSON.parse(output[0]))).toEqual(["mode", "total", "statuses"]);
    expect(output[0]).not.toContain(adminId);
    expect(output[0]).not.toContain(userId);
    expect(output[0]).not.toContain("dry-run reason");
    expect(output[0]).not.toContain("opaque-fixture");
    expect((await ctx.gen(queued.generationId))?.status).toBe("queued");
    expect((await ctx.gen(secondQueued.generationId))?.status).toBe("queued");
    expect((await ctx.gen(running.generationId))?.status).toBe("running");
    expect((await ctx.gen(terminal.generationId))?.status).toBe("succeeded");
    expect((await ctx.gen(system.generationId))?.status).toBe("queued");
    expect(await credentialCount([queued.generationId, secondQueued.generationId, running.generationId])).toBe(3);
    expect(await ctx.events(userId, "image_failed")).toHaveLength(0);
    expect(await ctx.sql`SELECT 1 FROM audit_log WHERE admin_id=${adminId}`).toHaveLength(0);
  });

  it("atomically fails every custom in-flight state and records safe events and one audit", async () => {
    const adminId = await ctx.createUser();
    const userId = await ctx.createUser({ balanceMp: 500 });
    const jobs = await Promise.all(
      (["queued", "queued", "claimed", "running"] as const).map((status) =>
        ctx.createGeneration(userId, { status, credentialMode: "custom" }),
      ),
    );
    for (const job of jobs) await addOpaqueCredential(job.generationId);
    await ctx.sql`UPDATE generations SET credits_charged_mp=99,http_status=503,error='old failure'
                  WHERE id=${jobs[3].generationId}`;
    const system = await ctx.createGeneration(userId, { status: "running", credentialMode: "system" });
    const output: string[] = [];

    const result = await runFailCustomGenerations(
      { adminId, reason: "rollback containment", apply: true, confirmation: APPLY_CONFIRMATION },
      { log: (line) => output.push(line) },
    );

    expect(result).toEqual({
      mode: "apply",
      matched: 4,
      failed: 4,
      statuses: { queued: 2, claimed: 1, running: 1 },
      remainingInFlight: 0,
      remainingTargetCredentials: 0,
    });
    const rows = await ctx.sql`SELECT id,status,error_code,error,http_status,credits_charged_mp,completed_at
                               FROM generations WHERE id=ANY(${jobs.map((job) => job.generationId)}::uuid[])
                               ORDER BY id`;
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "failed",
        error_code: "unknown",
        error: OPERATIONAL_FAILURE_MESSAGE,
        http_status: null,
      });
      expect(Number(row.credits_charged_mp)).toBe(0);
      expect(row.completed_at).toBeTruthy();
    }
    expect((await ctx.gen(system.generationId))?.status).toBe("running");
    expect(await credentialCount(jobs.map((job) => job.generationId))).toBe(0);
    expect(await ctx.ledger(userId, "debit")).toHaveLength(0);

    const events = await ctx.events(userId, "image_failed");
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining(
        jobs.map((job) => ({
          generationId: job.generationId,
          reason: "unknown",
          credentialMode: "custom",
          source: "fail_custom_generations",
        })),
      ),
    );
    expect(JSON.stringify(events)).not.toContain("rollback containment");
    expect(JSON.stringify(events)).not.toContain("opaque-fixture");

    const audits = await ctx.sql`SELECT admin_id,action,target_type,target_id,before,after,reason
                                 FROM audit_log WHERE admin_id=${adminId} AND action='fail_custom_generations'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      admin_id: adminId,
      target_type: "generation",
      target_id: null,
      reason: "rollback containment",
      before: { credentialMode: "custom", statuses: { queued: 2, claimed: 1, running: 1 } },
      after: { status: "failed", errorCode: "unknown", creditsChargedMp: 0, count: 4 },
    });
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(result);
    expect(output[0]).not.toContain(adminId);
    expect(output[0]).not.toContain(userId);
    expect(output[0]).not.toContain("rollback containment");
  });

  it("does not overwrite a success that wins the row-lock race", async () => {
    const adminId = await ctx.createUser();
    const userId = await ctx.createUser();
    const job = await ctx.createGeneration(userId, { status: "running", credentialMode: "custom" });
    await addOpaqueCredential(job.generationId);
    const lockerPool = getPool();
    const locker = await lockerPool.connect();

    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM generations WHERE id=$1 FOR UPDATE", [job.generationId]);
      const operation = runFailCustomGenerations(
        { adminId, reason: "race containment", apply: true, confirmation: APPLY_CONFIRMATION },
        { log: () => undefined },
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await locker.query(
        `UPDATE generations SET status='succeeded',credits_charged_mp=0,completed_at=now(),updated_at=now()
         WHERE id=$1 AND status='running'`,
        [job.generationId],
      );
      await locker.query("COMMIT");

      await expect(operation).resolves.toMatchObject({ matched: 0, failed: 0 });
    } finally {
      try {
        await locker.query("ROLLBACK");
      } catch {
        // The transaction was already committed or the connection was closed.
      }
      locker.release();
      await lockerPool.end();
    }

    const generation = await ctx.gen(job.generationId);
    expect(generation?.status).toBe("succeeded");
    expect(generation?.error_code).toBeNull();
    expect(await ctx.events(userId, "image_failed")).toHaveLength(0);
    expect(await credentialCount([job.generationId])).toBe(1);
    const audits = await ctx.sql`SELECT after FROM audit_log
                                 WHERE admin_id=${adminId} AND action='fail_custom_generations'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ count: 0 });
  });

  it("contains a very old running job without overflowing duration_ms", async () => {
    const adminId = await ctx.createUser();
    const userId = await ctx.createUser();
    const job = await ctx.createGeneration(userId, { status: "running", credentialMode: "custom" });
    await ctx.sql`UPDATE generations SET started_at=now()-interval '26 days' WHERE id=${job.generationId}`;
    await addOpaqueCredential(job.generationId);

    await expect(
      runFailCustomGenerations(
        {
          adminId,
          reason: "stale containment",
          apply: true,
          confirmation: APPLY_CONFIRMATION,
        },
        { log: () => undefined },
      ),
    ).resolves.toMatchObject({ failed: 1, remainingTargetCredentials: 0 });

    const generation = await ctx.gen(job.generationId);
    expect(generation?.status).toBe("failed");
    expect(Number(generation?.duration_ms)).toBe(2_147_483_647);
    expect(await credentialCount([job.generationId])).toBe(0);
  });

  it("rolls back status, event, and credential deletion when the audit cannot be written", async () => {
    const userId = await ctx.createUser();
    const job = await ctx.createGeneration(userId, { status: "queued", credentialMode: "custom" });
    await addOpaqueCredential(job.generationId);

    await expect(
      runFailCustomGenerations(
        {
          adminId: randomUUID(),
          reason: "invalid audit actor",
          apply: true,
          confirmation: APPLY_CONFIRMATION,
        },
        { log: () => undefined },
      ),
    ).rejects.toThrow();

    expect((await ctx.gen(job.generationId))?.status).toBe("queued");
    expect(await credentialCount([job.generationId])).toBe(1);
    expect(await ctx.events(userId, "image_failed")).toHaveLength(0);
  });
});
