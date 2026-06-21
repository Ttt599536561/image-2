// 抢占式状态机真库用例（03 §4.5 / 04 §5.3 / 10 §11.10）：两后台实例并发只 1 个抢到。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claim, markRunning } from "../../src/server/money/preempt.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("抢占式状态机（preempt）", () => {
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
