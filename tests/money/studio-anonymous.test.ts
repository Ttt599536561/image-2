import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateStudioSession, requireStudioSession } from "../../src/server/studio/session.server";
import { consumeStudioRate } from "../../src/server/studio/limits.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { finalizeCustomSuccess } from "../../src/server/generation/finalizeCustom.server";
import { type TestCtx, newCtx } from "./_helpers";

let ctx: TestCtx;
const originalKey = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
let originalRates: Array<{ bucket_hash: string; hits: number; expires_at: Date }>;
let nextIp = 1;
function browser(): Request {
  return new Request("https://studio.test/api/studio/session", { headers: { "x-studio-client-ip": `198.51.100.${nextIp++}` } });
}
async function owner() {
  const session = await getOrCreateStudioSession(browser());
  ctx.userIds.push(session.userId);
  return { id: session.userId, maxConcurrency: 10 };
}
const job = (generationId = randomUUID()) => ({ generationId, prompt: "test tree", size: "1024x1024", credentialMode: "custom" as const, customApiKey: "fixture-only-no-upstream", customBaseUrl: "https://images.example/v1" });

beforeEach(async () => {
  ctx = newCtx();
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  originalRates = await ctx.sql`SELECT * FROM studio_rate_limits` as typeof originalRates;
});
afterEach(async () => {
  await ctx.cleanup();
  const originalHashes = originalRates.map((row) => row.bucket_hash);
  await ctx.sql`DELETE FROM studio_rate_limits WHERE NOT(bucket_hash=ANY(${originalHashes}::text[]))`;
  for (const row of originalRates) await ctx.sql`INSERT INTO studio_rate_limits(bucket_hash,hits,expires_at) VALUES(${row.bucket_hash},${row.hits},${row.expires_at}) ON CONFLICT(bucket_hash) DO UPDATE SET hits=excluded.hits,expires_at=excluded.expires_at`;
  if (originalKey === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = originalKey;
});

describe("anonymous studio database isolation", () => {
  it("creates hash-only sessions without an auth account, balance, lot or ledger", async () => {
    const request = browser();
    const session = await getOrCreateStudioSession(request); ctx.userIds.push(session.userId);
    const token = session.cookie!.split(";")[0].split("=")[1];
    const restored = await requireStudioSession(new Request(request.url, { headers: { cookie: session.cookie!.split(";")[0] } }));
    expect(restored.userId).toBe(session.userId);
    const rows = await ctx.sql`SELECT token_hash FROM studio_sessions WHERE user_id=${session.userId}`;
    expect(rows).toEqual([{ token_hash: createHash("sha256").update(token).digest("hex") }]);
    expect(await ctx.sql`SELECT id FROM "user" WHERE id=${session.userId}`).toHaveLength(0);
    expect(await ctx.sql`SELECT user_id FROM credit_accounts WHERE user_id=${session.userId}`).toHaveLength(0);
    expect(await ctx.lots(session.userId)).toHaveLength(0);
    expect(await ctx.ledger(session.userId)).toHaveLength(0);
  });
  it("serializes twelve simultaneous submissions into exactly ten jobs", async () => {
    const user = await owner();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => enqueueGeneration({ user, input: job() })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof Response && r.reason.status === 429)).toHaveLength(2);
    expect(await ctx.sql`SELECT id FROM generations WHERE user_id=${user.id}`).toHaveLength(10);
    expect(await ctx.sql`SELECT user_id FROM credit_accounts WHERE user_id=${user.id}`).toHaveLength(0);
    expect(await ctx.ledger(user.id)).toHaveLength(0);
  });
  it("simultaneous retries produce one conversation, generation and credential", async () => {
    const user = await owner(); const input = job();
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueueGeneration({ user, input })));
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    expect(await ctx.sql`SELECT id FROM conversations WHERE user_id=${user.id}`).toHaveLength(1);
    expect(await ctx.sql`SELECT id FROM generations WHERE user_id=${user.id}`).toHaveLength(1);
    expect(await ctx.credentials(input.generationId)).toHaveLength(1);
    const other = await owner();
    await expect(enqueueGeneration({ user: other, input })).rejects.toMatchObject({ status: 404 });
  });
  it("enforces the global hundred-job cap across different owners", async () => {
    const seed = await owner(); const conversationId = randomUUID();
    await ctx.sql`INSERT INTO conversations(id,user_id,title) VALUES(${conversationId},${seed.id},'cap fixture')`;
    const [existing] = await ctx.sql`SELECT COUNT(*)::int AS n FROM generations WHERE status IN ('queued','claimed','running')`;
    const seedCount = 99 - Number(existing.n); expect(seedCount).toBeGreaterThan(0);
    await ctx.sql`INSERT INTO generations(conversation_id,user_id,prompt,size,status,credential_mode,deadline_at)
      SELECT ${conversationId},${seed.id},'cap fixture','1024x1024','queued','custom',now()+interval '5 minutes' FROM generate_series(1,${seedCount})`;
    const first = await owner(); const second = await owner();
    const results = await Promise.allSettled([enqueueGeneration({ user: first, input: job() }), enqueueGeneration({ user: second, input: job() })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof Response && r.reason.status === 429)).toHaveLength(1);
  });
  it("keeps paid and anonymous custom outputs for seven days and removes credentials", async () => {
    const user = await owner(); await ctx.sql`UPDATE users SET has_paid=true WHERE id=${user.id}`;
    const result = await enqueueGeneration({ user, input: job() });
    await ctx.sql`UPDATE generations SET status='running',started_at=now() WHERE id=${result.generationId}`;
    expect(await finalizeCustomSuccess({ generationId: result.generationId, userId: user.id, storageKey: "fixture/image.png", publicUrl: "/media/fixture/image.png", contentType: "image/png" })).toBe("succeeded");
    const [image] = await ctx.images(result.generationId);
    expect(Math.abs(new Date(String(image.expires_at)).getTime() - Date.now() - 7 * 86400000)).toBeLessThan(5000);
    expect(await ctx.credentials(result.generationId)).toHaveLength(0);
    expect(await ctx.ledger(user.id)).toHaveLength(0);
  });
  it("atomically limits same-IP session creation across connections", async () => {
    const request = browser();
    const results = await Promise.allSettled(Array.from({ length: 35 }, () => consumeStudioRate(request, "session")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof Response && r.reason.status === 429)).toHaveLength(5);
  });
});
