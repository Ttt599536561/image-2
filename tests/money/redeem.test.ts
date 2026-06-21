// 兑换核销真库用例（03 §4.7 / 07 §8.4 / 10 §11.10）：并发双击只入账一次 + 错误码 + 首兑升级顺延。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedeemError, redeemCode } from "../../src/server/money/redeem.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("兑换核销（redeem）", () => {
  it("并发双击同码：仅 1 次入账、另一次 410 CODE_USED、批次只建 1 个", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const { code } = await ctx.createCode({ creditsMp: 10000, cashValue: 990, validDays: 365 });

    const results = await Promise.allSettled([redeemCode({ userId: uid, code }), redeemCode({ userId: uid, code })]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    const err = (bad[0] as PromiseRejectedResult).reason as RedeemError;
    expect(err).toBeInstanceOf(RedeemError);
    expect(err.code).toBe("CODE_USED");
    expect(err.httpStatus).toBe(410);

    expect(await ctx.balanceMp(uid)).toBe(10000); // 只入账一次
    expect((await ctx.lots(uid)).filter((l) => l.source === "code").length).toBe(1);
    expect((await ctx.ledger(uid, "credit")).length).toBe(1);
  });

  it("码不存在 → 404 CODE_NOT_FOUND；已作废 → 410 CODE_DISABLED", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    await expect(redeemCode({ userId: uid, code: "ZZZZZZZZZZZZZZZZ22" })).rejects.toMatchObject({ code: "CODE_NOT_FOUND", httpStatus: 404 });

    const { code } = await ctx.createCode({ creditsMp: 10000, cashValue: 990, validDays: 365, status: "disabled" });
    await expect(redeemCode({ userId: uid, code })).rejects.toMatchObject({ code: "CODE_DISABLED", httpStatus: 410 });
    expect(await ctx.balanceMp(uid)).toBe(0);
  });

  it("valid_days=null → 永久批次（expires_at IS NULL）", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const { code } = await ctx.createCode({ creditsMp: 5000, cashValue: 500, validDays: null });
    await redeemCode({ userId: uid, code });
    const lot = (await ctx.lots(uid)).find((l) => l.source === "code");
    expect(lot?.expires_at).toBeNull();
  });

  it("首次兑换：has_paid 翻 true + 旧图保留期顺延到 ~60 天", async () => {
    const uid = await ctx.createUser({ balanceMp: 0, hasPaid: false });
    // 造一张 7 天后到期的旧图（succeeded gen + image）。
    const { generationId } = await ctx.createGeneration(uid, { status: "succeeded" });
    await ctx.sql`INSERT INTO images(generation_id,user_id,storage_key,public_url,expires_at)
                  VALUES (${generationId}, ${uid}, 'k', 'https://img.test/old.png', now() + interval '7 days')`;
    const { code } = await ctx.createCode({ creditsMp: 10000, cashValue: 990, validDays: 365 });

    await redeemCode({ userId: uid, code });

    const u = await ctx.sql`SELECT has_paid FROM users WHERE id=${uid}`;
    expect(u[0].has_paid).toBe(true);
    const img = await ctx.sql`SELECT expires_at FROM images WHERE generation_id=${generationId}`;
    const daysLeft = (new Date(img[0].expires_at as string).getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(59); // 顺延到 ~60 天
  });
});
