// 余额对账 cron 真库用例（10 §11.3 / §11.10）：制造 drift → 检出 + 以批次为准修正收敛。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reconcileBalances } from "../../src/server/money/reconcile.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("余额对账（reconcile）", () => {
  it("物化余额 != SUM(lots) → 检出并以批次为准修正 + balance_reconciled 事件", async () => {
    const uid = await ctx.createUser({ balanceMp: 100 });
    await ctx.addLot(uid, 100, { source: "code", expiresInDays: 60 });
    // 人为制造 drift：把物化余额改错（漏同步场景）。
    await ctx.sql`UPDATE credit_accounts SET balance_mp=50 WHERE user_id=${uid}`;

    const res = await reconcileBalances();
    expect(res.corrected).toBeGreaterThanOrEqual(1);
    expect(res.drifts.some((d) => d.userId === uid && d.authMp === "100" && d.driftMp === "50")).toBe(true);

    expect(await ctx.balanceMp(uid)).toBe(100); // 以批次为准修正
    expect((await ctx.events(uid, "balance_reconciled")).length).toBe(1);
  });
});
