// 积分过期 cron 真库用例（03 §4.8 / 10 §11.2 / §11.10）：到期批次清零幂等 + 永久批次跳过。
// 断言只针对本测试用户（expireCredits 全局扫描；不依赖全局计数）。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expireCredits } from "../../src/server/money/expire.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("积分过期（expire）", () => {
  it("到期批次清零 + expire 流水 + 同步余额；永久批次不动；重跑幂等", async () => {
    const uid = await ctx.createUser({ balanceMp: 150 });
    await ctx.addLot(uid, 50, { source: "code", expiresInDays: -1 }); // 已过期
    await ctx.addLot(uid, 100, { source: "code", expiresInDays: null }); // 永久

    await expireCredits();

    const lots = await ctx.lots(uid);
    const expiredLot = lots.find((l) => l.expires_at !== null);
    const permLot = lots.find((l) => l.expires_at === null);
    expect(Number(expiredLot?.remaining_mp)).toBe(0); // 清零
    expect(Number(permLot?.remaining_mp)).toBe(100); // 永久不动
    expect(await ctx.balanceMp(uid)).toBe(100); // 150 - 50
    expect((await ctx.ledger(uid, "expire")).length).toBe(1);

    // 重跑：uq_expire_lot 命中、不重复减、不重复记。
    await expireCredits();
    expect(await ctx.balanceMp(uid)).toBe(100);
    expect((await ctx.ledger(uid, "expire")).length).toBe(1);
  });
});
