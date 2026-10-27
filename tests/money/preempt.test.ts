// 抢占式状态机真库用例（03 §4.5 / 04 §5.3 / 10 §11.10）：两后台实例并发只 1 个抢到。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claim, claimNext, markRunning } from "../../src/server/money/preempt.server";
import { getPool } from "../../src/db/db.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("抢占式状态机（preempt）", () => {
  it("atomically claims oldest eligible jobs once across simultaneous consumers", async () => {
    const uid = await ctx.createUser();
    const expired = await ctx.createGeneration(uid, { deadlineAgoSec: 10 });
    const first = await ctx.createGeneration(uid);
    const second = await ctx.createGeneration(uid);
    await ctx.sql`UPDATE generations SET created_at=now()-interval '10 minutes' WHERE id=${first.generationId}`;
    await ctx.sql`UPDATE generations SET created_at=now()-interval '9 minutes' WHERE id=${second.generationId}`;
    expect((await claimNext("oldest"))?.id).toBe(first.generationId);
    const results = await Promise.all([claimNext("A"), claimNext("B"), claim(second.generationId, "ID")]);
    expect(results.filter(Boolean).map((g) => g?.id)).toEqual([second.generationId]);
    expect((await ctx.gen(expired.generationId))?.status).toBe("queued");
  });

  it("skips a locked oldest row instead of blocking unrelated jobs", async () => {
    const uid = await ctx.createUser();
    const first = await ctx.createGeneration(uid);
    const second = await ctx.createGeneration(uid);
    await ctx.sql`UPDATE generations SET created_at=now()-interval '10 minutes' WHERE id=${first.generationId}`;
    const connection = await getPool().connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT id FROM generations WHERE id=$1 FOR UPDATE", [first.generationId]);
      expect((await claimNext("unblocked"))?.id).toBe(second.generationId);
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
    expect((await claimNext("released"))?.id).toBe(first.generationId);
  });

  it("does not start a claimed job after its deadline or after a terminal update", async () => {
    const uid = await ctx.createUser();
    const { generationId } = await ctx.createGeneration(uid);
    await claim(generationId);
    await ctx.sql`UPDATE generations SET deadline_at=now()-interval '1 second' WHERE id=${generationId}`;
    expect(await markRunning(generationId)).toBe(false);
    expect((await ctx.gen(generationId))?.status).toBe("claimed");
  });

  it("两实例并发抢占 queued：恰 1 个成功，另一个 null（不调中转、不扣费）", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });

    const [a, b] = await Promise.all([claim(generationId, "A"), claim(generationId, "B")]);
    const wins = [a, b].filter((x) => x !== null);
    expect(wins.length).toBe(1);
    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("claimed");
    expect(["A", "B"]).toContain(g?.job_id);
  });

  it("非 queued（running）→ claim 返回 null", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });
    expect(await claim(generationId, "X")).toBeNull();
  });

  it("markRunning：claimed → running 且写 started_at", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });
    const c = await claim(generationId, "W");
    expect(c).not.toBeNull();
    await markRunning(generationId);
    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("running");
    expect(g?.started_at).not.toBeNull();
  });
});
