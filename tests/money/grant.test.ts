// 注册原子发放真库用例（03 §4.4 / 05 §6.6 / 10 §11.10）：建号即发 140mp，重试/并发不重发（uq_grant_signup + 串行化闸）。
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { grantSignup } from "../../src/server/money/grant.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("注册原子发放（grant）", () => {
  it("首次发放 140mp：1 signup 批次 + 1 grant 账本 + events", async () => {
    const uid = randomUUID();
    ctx.userIds.push(uid); // 交给 cleanup
    await grantSignup(uid, `grant+${uid.slice(0, 8)}@example.com`);

    expect(await ctx.balanceMp(uid)).toBe(140);
    const lots = await ctx.lots(uid);
    expect(lots.length).toBe(1);
    expect(lots[0].source).toBe("signup");
    expect(lots[0].expires_at).not.toBeNull(); // 30 天到期
    expect((await ctx.ledger(uid, "grant")).length).toBe(1);
    const evTypes = (await ctx.events(uid)).map((e) => e.type).sort();
    expect(evTypes).toContain("credit_granted");
    expect(evTypes).toContain("user_registered");
  });

  it("重试/并发不重发：再调（含并发）仍只 1 批次 / 1 账本 / 余额 140", async () => {
    const uid = randomUUID();
    ctx.userIds.push(uid);
    const email = `grant+${uid.slice(0, 8)}@example.com`;
    await grantSignup(uid, email);
    // 顺序重放 + 并发重放。
    await grantSignup(uid, email);
    await Promise.allSettled([grantSignup(uid, email), grantSignup(uid, email)]);

    expect(await ctx.balanceMp(uid)).toBe(140);
    expect((await ctx.lots(uid)).length).toBe(1);
    expect((await ctx.ledger(uid, "grant")).length).toBe(1);
  });
});
