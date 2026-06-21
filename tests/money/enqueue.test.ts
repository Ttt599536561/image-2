// 入队三闸真库用例（03 §4.9 / 04 §5.2 / 07 §8.3 / 10 §11.10）：并发 409 / 余额 402 / 软预算 429（只判不扣、不入队）。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey } from "../../src/server/budget.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0; // 未抛 = 通过
  } catch (e) {
    return (e as Response).status;
  }
}

let ctx: TestCtx;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(() => {
  ctx = newCtx();
});
afterEach(async () => {
  await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`; // 清当日预算键，避免污染其它用例
  await ctx.cleanup();
});

describe("入队三闸（enqueue）", () => {
  it("余额不足（<70mp）→ 402、不入队、不扣费", async () => {
    const uid = await ctx.createUser({ balanceMp: 60 });
    await ctx.addLot(uid, 60, { source: "signup" });
    const s = await status(enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "p", size: "auto" } }));
    expect(s).toBe(402);
    expect((await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).length).toBe(0); // 未入队
  });

  it("余额恰够（70mp）→ 通过、建会话 + queued 行", async () => {
    const uid = await ctx.createUser({ balanceMp: 70 });
    await ctx.addLot(uid, 70, { source: "signup" });
    const res = await enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "hello world", size: "1024x1024" } });
    expect(res.generationId).toBeTruthy();
    const g = await ctx.gen(res.generationId);
    expect(g?.status).toBe("queued");
    expect(g?.model).toBe("gpt-image-2");
    expect(await ctx.balanceMp(uid)).toBe(70); // 只判不扣
  });

  it("并发已满（max=2，2 个进行中）→ 409", async () => {
    const uid = await ctx.createUser({ balanceMp: 1000 });
    await ctx.addLot(uid, 1000, { source: "signup" });
    await ctx.createGeneration(uid, { status: "running" });
    await ctx.createGeneration(uid, { status: "queued" });
    const s = await status(enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "p", size: "auto" } }));
    expect(s).toBe(409);
  });

  it("软预算熔断（当日 calls 触阈）→ 429、不入队", async () => {
    const uid = await ctx.createUser({ balanceMp: 1000 });
    await ctx.addLot(uid, 1000, { source: "signup" });
    // 把当日预算计数顶到阈值之上（cap 默认 2000）。
    await ctx.sql`INSERT INTO app_config(key,value_json) VALUES (${budgetTodayKey()}, '{"calls":99999999,"ms":0}'::jsonb)
                  ON CONFLICT (key) DO UPDATE SET value_json='{"calls":99999999,"ms":0}'::jsonb`;
    const s = await status(enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "p", size: "auto" } }));
    expect(s).toBe(429);
    expect((await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).length).toBe(0);
  });
});
