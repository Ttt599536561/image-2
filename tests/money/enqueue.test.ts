// 入队三闸真库用例（03 §4.9 / 04 §5.2 / 07 §8.3 / 10 §11.10）：并发 409 / 余额 402 / 软预算 429（只判不扣、不入队）。
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey } from "../../src/server/budget.server";
import { enqueueGeneration } from "../../src/server/generation/enqueue";
import { type TestCtx, ensureSeedConfig, newCtx, priceMp } from "./_helpers";

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0; // 未抛 = 通过
  } catch (e) {
    return (e as Response).status;
  }
}

let ctx: TestCtx;
let PRICE = 70; // 当前生效单图价（mp），beforeAll 读取，余额闸阈值据此算
beforeAll(async () => {
  const sql = newCtx().sql;
  await ensureSeedConfig(sql);
  PRICE = await priceMp(sql);
});
beforeEach(() => {
  ctx = newCtx();
});
afterEach(async () => {
  await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`; // 清当日预算键，避免污染其它用例
  await ctx.cleanup();
});

describe("入队三闸（enqueue）", () => {
  it("余额不足（<单价）→ 402、不入队、不扣费", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE - 1 });
    await ctx.addLot(uid, PRICE - 1, { source: "signup" });
    const s = await status(enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "p", size: "auto" } }));
    expect(s).toBe(402);
    expect((await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).length).toBe(0); // 未入队
  });

  it("余额恰够（=单价）→ 通过、建会话 + queued 行", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE });
    await ctx.addLot(uid, PRICE, { source: "signup" });
    const res = await enqueueGeneration({ user: { id: uid, maxConcurrency: 2 }, input: { prompt: "hello world", size: "1024x1024" } });
    expect(res.generationId).toBeTruthy();
    const g = await ctx.gen(res.generationId);
    expect(g?.status).toBe("queued");
    expect(g?.model).toBe("gpt-image-2");
    expect(await ctx.balanceMp(uid)).toBe(PRICE); // 只判不扣
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

  it("④b 图生图：input_image_key 属本人 → 入队、落库", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE });
    await ctx.addLot(uid, PRICE, { source: "signup" });
    const key = `uploads/${uid}/2026/06/ref.png`;
    const res = await enqueueGeneration({
      user: { id: uid, maxConcurrency: 2 },
      input: { prompt: "把背景换成海边", size: "auto", inputImageKey: key },
    });
    const g = await ctx.gen(res.generationId);
    expect(g?.input_image_key).toBe(key);
  });

  it("④b owner-scope：input_image_key 属他人 → 400、不入队（越权防线）", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE });
    await ctx.addLot(uid, PRICE, { source: "signup" });
    const othersKey = `uploads/${randomUUID()}/2026/06/ref.png`;
    const s = await status(
      enqueueGeneration({
        user: { id: uid, maxConcurrency: 2 },
        input: { prompt: "p", size: "auto", inputImageKey: othersKey },
      }),
    );
    expect(s).toBe(400);
    expect((await ctx.sql`SELECT 1 FROM generations WHERE user_id=${uid}`).length).toBe(0);
  });

  it("乐观立即跳转：客户端提供 conversationId+generationId → 用该 id 建会话 + queued 行", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE });
    await ctx.addLot(uid, PRICE, { source: "signup" });
    const cid = randomUUID();
    const gid = randomUUID();
    const res = await enqueueGeneration({
      user: { id: uid, maxConcurrency: 2 },
      input: { prompt: "hello world", size: "1024x1024", conversationId: cid, generationId: gid },
    });
    expect(res.conversationId).toBe(cid); // 用客户端 id
    expect(res.generationId).toBe(gid);
    const g = await ctx.gen(gid);
    expect(g?.status).toBe("queued");
    expect(g?.conversation_id).toBe(cid);
    const conv = (await ctx.sql`SELECT user_id FROM conversations WHERE id=${cid}`) as Array<{ user_id: string }>;
    expect(conv.length).toBe(1);
    expect(conv[0].user_id).toBe(uid); // owner=本人
  });

  it("乐观跳转 owner-scope：客户端 conversationId 属他人 → 404、不入队、不改他人会话", async () => {
    const owner = await ctx.createUser({ balanceMp: PRICE });
    const ownerConv = randomUUID();
    await ctx.sql`INSERT INTO conversations(id, user_id, title) VALUES(${ownerConv}, ${owner}, 'owned')`;
    const attacker = await ctx.createUser({ balanceMp: PRICE });
    await ctx.addLot(attacker, PRICE, { source: "signup" });
    const s = await status(
      enqueueGeneration({
        user: { id: attacker, maxConcurrency: 2 },
        input: { prompt: "p", size: "auto", conversationId: ownerConv, generationId: randomUUID() },
      }),
    );
    expect(s).toBe(404); // 他人占用该 id → upsert 不命中、拒
    expect((await ctx.sql`SELECT 1 FROM generations WHERE conversation_id=${ownerConv}`).length).toBe(0);
    const conv = (await ctx.sql`SELECT user_id FROM conversations WHERE id=${ownerConv}`) as Array<{ user_id: string }>;
    expect(conv[0].user_id).toBe(owner); // 他人会话 owner 不变
  });
});
