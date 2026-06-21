// 管理员调积分真库用例（09 §10.3 / §11.10 命门补强）：同事务动 lots + 物化余额 + ledger(adjust) + audit；
// 减不出负记真实 moved；关键红线——adjust 后对账无 drift（防「只动余额不动 lots」被对账反转）。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adjustCredit } from "../../src/server/money/adjust.server";
import { expireCredits } from "../../src/server/money/expire.server";
import { reconcileBalances } from "../../src/server/money/reconcile.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
let adminId: string;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(async () => {
  ctx = newCtx();
  adminId = await ctx.createUser({ balanceMp: 0 }); // 充当操作管理员（audit.admin_id FK）
});
afterEach(() => ctx.cleanup());

describe("管理员调积分（adjust）", () => {
  it("增额：建 adjust 批次 + 余额 +delta + ledger + audit + credit_granted；对账无 drift", async () => {
    const uid = await ctx.createUser({ balanceMp: 0 });
    const r = await adjustCredit({ adminId, userId: uid, deltaMp: 5000, reason: "补偿", validDays: 30 });
    expect(r.moved).toBe(5000);

    expect(await ctx.balanceMp(uid)).toBe(5000);
    const lots = await ctx.lots(uid);
    expect(lots.length).toBe(1);
    expect(lots[0].source).toBe("adjust");
    expect(Number(lots[0].remaining_mp)).toBe(5000);
    const led = await ctx.ledger(uid, "adjust");
    expect(led.length).toBe(1);
    expect(Number(led[0].amount_mp)).toBe(5000);
    expect(String(led[0].reason)).toMatch(/^\+ /);
    const audit = await ctx.sql`SELECT * FROM audit_log WHERE admin_id=${adminId} AND target_id=${uid}`;
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("adjust_credit");
    expect((await ctx.events(uid, "credit_granted")).length).toBe(1);

    // 红线：lots 与物化余额一致 → 对账判定本用户无 drift。
    const rec = await reconcileBalances();
    expect(rec.drifts.some((d) => d.userId === uid)).toBe(false);
  });

  it("减额：FIFO 扣 + 余额 -moved + credit_consumed；对账无 drift", async () => {
    const uid = await ctx.createUser({ balanceMp: 5000 });
    await ctx.addLot(uid, 5000, { source: "code", expiresInDays: 60 });
    const r = await adjustCredit({ adminId, userId: uid, deltaMp: -2000, reason: "扣回" });
    expect(r.moved).toBe(2000);

    expect(await ctx.balanceMp(uid)).toBe(3000);
    expect(Number((await ctx.lots(uid))[0].remaining_mp)).toBe(3000);
    const led = await ctx.ledger(uid, "adjust");
    expect(Number(led[0].amount_mp)).toBe(2000);
    expect(String(led[0].reason)).toMatch(/^- /);
    expect((await ctx.events(uid, "credit_consumed")).length).toBe(1);

    const rec = await reconcileBalances();
    expect(rec.drifts.some((d) => d.userId === uid)).toBe(false);
  });

  it("减额超余额：扣到 0 不出负，ledger 记真实 moved（非请求量）", async () => {
    const uid = await ctx.createUser({ balanceMp: 1000 });
    await ctx.addLot(uid, 1000, { source: "code", expiresInDays: 60 });
    const r = await adjustCredit({ adminId, userId: uid, deltaMp: -5000, reason: "清空" });
    expect(r.moved).toBe(1000); // 真实扣到 1000，非请求的 5000

    expect(await ctx.balanceMp(uid)).toBe(0);
    expect(Number((await ctx.lots(uid))[0].remaining_mp)).toBe(0);
    expect(Number((await ctx.ledger(uid, "adjust"))[0].amount_mp)).toBe(1000);
    const rec = await reconcileBalances();
    expect(rec.drifts.some((d) => d.userId === uid)).toBe(false);
  });

  // 对抗审查发现的回归（major）：减额必须只扣「可用（未过期）」批次，绝不落在过期未清批次上被对账反转。
  it("减额避开过期未清批次：扣有效批次 → 经 expire+reconcile 后管理员意图存活", async () => {
    const uid = await ctx.createUser({ balanceMp: 300 });
    const expiredLotId = await ctx.addLot(uid, 100, { source: "code", expiresInDays: -1 }); // 已过期、未清
    await ctx.addLot(uid, 200, { source: "code", expiresInDays: 60 }); // 有效

    const r = await adjustCredit({ adminId, userId: uid, deltaMp: -50, reason: "扣可用" });
    expect(r.moved).toBe(50);

    // 关键：50 必须从「有效批次」(200→150) 扣，过期批次(100)原封不动。
    const lots = await ctx.lots(uid);
    const expired = lots.find((l) => l.id === expiredLotId);
    const valid = lots.find((l) => l.id !== expiredLotId);
    expect(Number(expired?.remaining_mp)).toBe(100); // 过期批次未被动
    expect(Number(valid?.remaining_mp)).toBe(150); // 有效批次扣了 50
    expect(await ctx.balanceMp(uid)).toBe(250); // 300 - 50

    // 过期 cron 清掉过期批次（100→0，余额 250→150），再对账：管理员的 −50 存活（可用 = 200−50 = 150）。
    await expireCredits();
    expect(await ctx.balanceMp(uid)).toBe(150);
    const rec = await reconcileBalances();
    expect(rec.drifts.some((d) => d.userId === uid)).toBe(false); // 无漂移：lots(未过期)=150=balance
    expect(await ctx.balanceMp(uid)).toBe(150);
  });
});
