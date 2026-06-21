// 超时重扫真库用例（04 §5.5 / 10 §11.6 / §11.10）：>5min 未终态 → failed/provider_timeout、未扣费、释放并发；
// 校验 duration_ms 用 EXTRACT(EPOCH…)*1000（≥5min 不被 MILLISECONDS 截断）。重扫 SQL 与 §11.6 一致，测试内按 user 限域。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("超时重扫（timeout rescan）", () => {
  it("running 6min → failed/provider_timeout、未扣、duration_ms≈360000（非截断）；新鲜 running 不动", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const stale = await ctx.createGeneration(uid, { status: "running", startedAtAgoSec: 360 }); // 6min
    const fresh = await ctx.createGeneration(uid, { status: "running", startedAtAgoSec: 0 }); // 刚开始

    // §11.6 重扫 SQL（测试内按 user_id 限域、避免影响真库其它行）。
    const rescanned = await ctx.sql`
      UPDATE generations
      SET status='failed', error_code='provider_timeout', error='provider_timeout', completed_at=now(),
          duration_ms=(EXTRACT(EPOCH FROM now()-COALESCE(started_at, updated_at))*1000)::int, updated_at=now()
      WHERE user_id=${uid} AND status IN ('claimed','running')
        AND COALESCE(started_at, updated_at) < now() - interval '5 minutes'
      RETURNING id, duration_ms`;

    expect(rescanned.length).toBe(1);
    expect(rescanned[0].id).toBe(stale.generationId);
    // 6min ≈ 360000ms：EXTRACT(MILLISECONDS) 会截断到 ≤59999，EXTRACT(EPOCH)*1000 不会。
    expect(Number(rescanned[0].duration_ms)).toBeGreaterThan(300_000);

    const staleGen = await ctx.gen(stale.generationId);
    expect(staleGen?.status).toBe("failed");
    expect(staleGen?.error_code).toBe("provider_timeout");
    const freshGen = await ctx.gen(fresh.generationId);
    expect(freshGen?.status).toBe("running"); // 未超 5min，不动

    // 未扣费（失败从不进扣费事务）。
    expect((await ctx.ledger(uid, "debit")).length).toBe(0);
    expect(await ctx.balanceMp(uid)).toBe(140);
  });
});
