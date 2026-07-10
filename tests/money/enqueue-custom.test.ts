import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey } from "../../src/server/budget.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { type TestCtx, newCtx } from "./_helpers";

const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let ctx: TestCtx;
let previousBudget: unknown;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  ctx = newCtx();
  previousBudget = undefined;
});

afterEach(async () => {
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
  if (previousBudget === undefined) {
    await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;
  } else {
    await ctx.sql`INSERT INTO app_config(key,value_json) VALUES(${budgetTodayKey()},${JSON.stringify(previousBudget)}::jsonb)
                  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
  }
  await ctx.cleanup();
});

describe("custom enqueue", () => {
  it("queues three encrypted jobs with zero balance while system gates are full", async () => {
    const userId = await ctx.createUser({ balanceMp: 0, maxConcurrency: 1 });
    await ctx.createGeneration(userId, { status: "running", credentialMode: "system" });
    const [budgetBefore] = await ctx.sql`SELECT value_json FROM app_config WHERE key=${budgetTodayKey()}`;
    previousBudget = budgetBefore?.value_json;
    await ctx.sql`INSERT INTO app_config(key,value_json)
                  VALUES(${budgetTodayKey()},'{"calls":99999999,"ms":0}'::jsonb)
                  ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;

    const plaintext = "fictional-custom-enqueue-value";
    const results = await Promise.all(
      ["one", "two", "three"].map((prompt) =>
        enqueueGeneration({
          user: { id: userId, maxConcurrency: 1 },
          input: { prompt, size: "auto", credentialMode: "custom", customApiKey: plaintext },
        }),
      ),
    );

    expect(results).toHaveLength(3);
    const ids = results.map((result) => result.generationId);
    const rows = await ctx.sql`SELECT credential_mode,credits_charged_mp,
                                      EXTRACT(EPOCH FROM deadline_at-created_at)::int AS ttl_seconds
                               FROM generations WHERE id=ANY(${ids}::uuid[])`;
    expect(rows.every((row) => row.credential_mode === "custom" && Number(row.credits_charged_mp) === 0)).toBe(true);
    expect(rows.every((row) => Number(row.ttl_seconds) === 300)).toBe(true);
    const credentials = await ctx.sql`SELECT * FROM generation_credentials WHERE generation_id=ANY(${ids}::uuid[])`;
    expect(credentials).toHaveLength(3);
    expect(JSON.stringify(credentials)).not.toContain(plaintext);
  });

  it("does not let a custom job consume the system concurrency slot", async () => {
    const userId = await ctx.createUser({ balanceMp: 1_000, maxConcurrency: 1 });
    await ctx.addLot(userId, 1_000);
    await ctx.createGeneration(userId, { status: "running", credentialMode: "custom" });
    await expect(
      enqueueGeneration({
        user: { id: userId, maxConcurrency: 1 },
        input: { prompt: "system retains its slot", size: "auto", credentialMode: "system" },
      }),
    ).resolves.toMatchObject({ credentialMode: "system" });
  });

  it("keeps upload owner checks for custom jobs", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    await expect(
      enqueueGeneration({
        user: { id: userId, maxConcurrency: 2 },
        input: {
          prompt: "edit",
          size: "auto",
          inputImageKey: `uploads/${randomUUID()}/ref.png`,
          credentialMode: "custom",
          customApiKey: "fictional-owner-check",
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ctx.sql`SELECT 1 FROM generations WHERE user_id=${userId}`).toHaveLength(0);
  });

  it("fails before creating rows when encryption is unavailable", async () => {
    const userId = await ctx.createUser({ balanceMp: 0 });
    delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
    await expect(
      enqueueGeneration({
        user: { id: userId, maxConcurrency: 2 },
        input: {
          prompt: "no encryption",
          size: "auto",
          credentialMode: "custom",
          customApiKey: "fictional-unavailable-value",
        },
      }),
    ).rejects.toThrow("custom credential encryption is unavailable");
    expect(await ctx.sql`SELECT 1 FROM generations WHERE user_id=${userId}`).toHaveLength(0);
  });
});
