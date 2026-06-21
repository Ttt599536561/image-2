// 扣费事务真库用例（03 §4.3 / §4.3.1 / 10 §11.10）：成功才扣 + generation_id 幂等 + ⓪双守卫 + FIFO 跨批。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chargeOnSuccess } from "../../src/server/money/debit.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

const PUT = (genId: string) => ({
  generationId: genId,
  storageKey: `mtest/${genId}.png`,
  publicUrl: `https://img.test/${genId}.png`,
  contentType: "image/png",
  width: 1024,
  height: 1024,
  sizeBytes: 1000,
});

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(() => ctx.cleanup());

describe("扣费事务（debit）", () => {
  it("正常成功扣 70mp：余额减一次、1 条 debit 账本、1 张 image、gen=succeeded", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup", expiresInDays: 30 });
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });

    const r = await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    expect(r.outcome).toBe("charged");
    expect(r.charged).toBe(70);
    expect(r.balanceAfter).toBe(70);

    expect(await ctx.balanceMp(uid)).toBe(70);
    expect((await ctx.ledger(uid, "debit")).length).toBe(1);
    expect((await ctx.images(generationId)).length).toBe(1);
    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("succeeded");
    expect(Number(g?.credits_charged_mp)).toBe(70);
    expect(Number(g?.duration_ms)).toBeGreaterThanOrEqual(0); // EXTRACT(EPOCH)*1000，非 MILLISECONDS 截断
  });

  it("平台重试重入（顺序）：第二次 ⓪a 见非 running → no-op，仅扣 1 次", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });

    await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    const second = await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    expect(second.outcome).toBe("not_running"); // 第二次进来 gen 已 succeeded
    expect(second.charged).toBe(0);

    expect(await ctx.balanceMp(uid)).toBe(70);
    expect((await ctx.ledger(uid, "debit")).length).toBe(1);
    expect((await ctx.images(generationId)).length).toBe(1);
  });

  it("⓪b 探 uq_debit：gen 被外部重置回 running 仍不重复扣（幂等 no-op）", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });

    await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    // 人为把 gen 拨回 running（模拟重投/竞态），让第二次越过 ⓪a、撞 ⓪b。
    await ctx.sql`UPDATE generations SET status='running' WHERE id=${generationId}`;
    const second = await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    expect(second.outcome).toBe("idempotent");
    expect(second.charged).toBe(0);

    expect(await ctx.balanceMp(uid)).toBe(70); // 仍只扣一次
    expect((await ctx.ledger(uid, "debit")).length).toBe(1);
    expect((await ctx.gen(generationId))?.status).toBe("succeeded");
  });

  it("真并发重入（Promise.all）：恰好扣一次、1 debit、1 image", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });

    const [a, b] = await Promise.all([
      chargeOnSuccess({ userId: uid, ...PUT(generationId) }),
      chargeOnSuccess({ userId: uid, ...PUT(generationId) }),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    // 一个 charged、另一个被 ⓪a/⓪b 挡（not_running 或 idempotent）。
    expect(outcomes).toContain("charged");
    expect(a.charged + b.charged).toBe(70);

    expect(await ctx.balanceMp(uid)).toBe(70);
    expect((await ctx.ledger(uid, "debit")).length).toBe(1);
    expect((await ctx.images(generationId)).length).toBe(1);
  });

  it("FIFO 跨批：先扣最早过期批次到 0，再扣下一批；各批不出负", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    // 按 lot id 断言（确定性）：不靠 expires_at 字符串排序（neon 返 Date，String(Date) 按星期名排序会随日历漂）。
    const early = await ctx.addLot(uid, 40, { source: "code", expiresInDays: 1 }); // 早过期，FIFO 先扣
    const late = await ctx.addLot(uid, 100, { source: "code", expiresInDays: 60 }); // 晚过期
    const { generationId } = await ctx.createGeneration(uid, { status: "running" });

    const r = await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    expect(r.charged).toBe(70);

    const lots = await ctx.lots(uid);
    expect(Number(lots.find((l) => l.id === early)?.remaining_mp)).toBe(0); // 早过期批次扣空
    expect(Number(lots.find((l) => l.id === late)?.remaining_mp)).toBe(70); // 100 - 30
    expect(await ctx.balanceMp(uid)).toBe(70);
  });

  it("⓪a 失败守卫：gen=failed（超时 cron 已置）→ 绝不扣费、不插 image（成功才扣硬边界）", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "failed" });

    const r = await chargeOnSuccess({ userId: uid, ...PUT(generationId) });
    expect(r.outcome).toBe("not_running");
    expect(await ctx.balanceMp(uid)).toBe(140); // 未扣
    expect((await ctx.ledger(uid, "debit")).length).toBe(0);
    expect((await ctx.images(generationId)).length).toBe(0);
  });
});
