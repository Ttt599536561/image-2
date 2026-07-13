// 后台生图编排真库用例（04 §5.3 / §11.10）：抢占→预算硬闸→[桩 relay]→[桩 putToR2]→扣费→终态。
// 注入 callRelay/putToR2 桩，免烧中转/Supabase（二者已各自冒烟验过）；只验 DB-as-queue 编排 + 成功才扣 + 幂等。
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PutResult } from "../../src/server/r2.server";
import { budgetTodayKey } from "../../src/server/budget.server";
import { type ProcessDeps, runGenerationJob } from "../../src/server/generation/process";
import { type TestCtx, ensureSeedConfig, newCtx, priceMp } from "./_helpers";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// 桩：callRelay 返回一张 b64 图；putToR2 返回假存储信息（不写 Supabase）。
const stubDeps = (): ProcessDeps => ({
  callRelay: async (request) => {
    expect(request.credential).toEqual({ mode: "system" });
    expect(request.deadlineAt).toBeInstanceOf(Date);
    return { images: [{ b64_json: TINY_PNG_B64 }] };
  },
  putToR2: async (_uid: string, gid: string): Promise<PutResult> => ({
    storageKey: `mtest/${gid}.png`,
    publicUrl: `https://img.test/${gid}.png`,
    contentType: "image/png",
    width: 1,
    height: 1,
    sizeBytes: 70,
  }),
});

async function createStoredSource(userId: string): Promise<{
  generationId: string;
  imageId: string;
  storageKey: string;
}> {
  const source = await ctx.createGeneration(userId, { status: "succeeded" });
  const imageId = randomUUID();
  const storageKey = `sources/${imageId}.png`;
  await ctx.sql`INSERT INTO images(id,generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes)
                VALUES(${imageId},${source.generationId},${userId},${storageKey},${`/media/${storageKey}`},'image/png',1,1,68)`;
  return { generationId: source.generationId, imageId, storageKey };
}

async function createSourceEdit(userId: string, sourceImageId: string): Promise<string> {
  const child = await ctx.createGeneration(userId, { status: "queued" });
  await ctx.sql`UPDATE generations SET source_image_id=${sourceImageId} WHERE id=${child.generationId}`;
  return child.generationId;
}

let ctx: TestCtx;
let PRICE = 70; // 当前生效单图价（mp），beforeAll 读取，断言据此算
beforeAll(async () => {
  const sql = newCtx().sql;
  await ensureSeedConfig(sql);
  PRICE = await priceMp(sql);
});
beforeEach(() => {
  ctx = newCtx();
});
afterEach(async () => {
  await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`; // 清当日预算键（runGenerationJob 会 incCall/incMs）
  await ctx.cleanup();
});

describe("后台生图编排（runGenerationJob）", () => {
  it("queued → 成功：扣单价、images 1 张、gen=succeeded、duration_ms 落库", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });

    const outcome = await runGenerationJob(generationId, stubDeps());
    expect(outcome).toBe("succeeded");

    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("succeeded");
    expect(Number(g?.credits_charged_mp)).toBe(PRICE);
    expect(Number(g?.duration_ms)).toBeGreaterThanOrEqual(0);
    expect((await ctx.images(generationId)).length).toBe(1);
    expect(await ctx.balanceMp(uid)).toBe(140 - PRICE);
  });

  it("平台重试：终态后再调 → claim 抢不到（lost），不重复扣", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });

    await runGenerationJob(generationId, stubDeps());
    const again = await runGenerationJob(generationId, stubDeps());
    expect(again).toBe("lost");
    expect(await ctx.balanceMp(uid)).toBe(140 - PRICE); // 仍只扣一次
    expect((await ctx.ledger(uid, "debit")).length).toBe(1);
    expect((await ctx.images(generationId)).length).toBe(1);
  });

  it("两后台实例并发：恰一个 succeeded、另一个 lost；扣一次、1 image", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });

    const [a, b] = await Promise.all([
      runGenerationJob(generationId, stubDeps()),
      runGenerationJob(generationId, stubDeps()),
    ]);
    expect([a, b].filter((x) => x === "succeeded").length).toBe(1);
    expect([a, b].filter((x) => x === "lost").length).toBe(1);
    expect(await ctx.balanceMp(uid)).toBe(140 - PRICE);
    expect((await ctx.images(generationId)).length).toBe(1);
  });

  it("预算硬上限命中：不调中转、置 failed/insufficient_quota、未扣费", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });
    // 顶满当日预算（cap 默认 2000）。
    await ctx.sql`INSERT INTO app_config(key,value_json) VALUES (${budgetTodayKey()}, '{"calls":99999999,"ms":0}'::jsonb)
                  ON CONFLICT (key) DO UPDATE SET value_json='{"calls":99999999,"ms":0}'::jsonb`;

    const outcome = await runGenerationJob(generationId, stubDeps());
    expect(outcome).toBe("budget_exhausted");
    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("failed");
    expect(g?.error_code).toBe("insufficient_quota");
    expect(await ctx.balanceMp(uid)).toBe(140); // 未扣
    expect((await ctx.images(generationId)).length).toBe(0);
  });

  it("④b 图生图：input_image_key → 回读字节 + callRelay 收到 inputImage、成功同价扣 70", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });
    const key = `uploads/${uid}/2026/06/ref.png`;
    await ctx.sql`UPDATE generations SET input_image_key=${key} WHERE id=${generationId}`;

    let getCalledWith: string | null = null;
    let sawInput: { contentType: string; filename: string } | null = null;
    const deps: ProcessDeps = {
      getUploadObject: async (k: string) => {
        getCalledWith = k;
        return { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png", filename: "ref.png" };
      },
      callRelay: async (req) => {
        sawInput = req.inputImage
          ? { contentType: req.inputImage.contentType, filename: req.inputImage.filename }
          : null;
        return { images: [{ b64_json: TINY_PNG_B64 }] };
      },
      putToR2: async (_uid: string, gid: string): Promise<PutResult> => ({
        storageKey: `mtest/${gid}.png`,
        publicUrl: `https://img.test/${gid}.png`,
        contentType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: 70,
      }),
    };
    const outcome = await runGenerationJob(generationId, deps);
    expect(outcome).toBe("succeeded");
    expect(getCalledWith).toBe(key); // 用对了 owner 的 key
    expect(sawInput).toEqual({ contentType: "image/png", filename: "ref.png" }); // 走 edits 分支
    expect(await ctx.balanceMp(uid)).toBe(140 - PRICE); // 图生图同价
  });

  it("④b 图生图：参考图回读失败 → failed/invalid_request、未扣费、不调中转", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });
    await ctx.sql`UPDATE generations SET input_image_key=${`uploads/${uid}/2026/06/gone.png`} WHERE id=${generationId}`;

    let relayCalled = false;
    const deps: ProcessDeps = {
      getUploadObject: async () => {
        throw new Error("NoSuchKey");
      },
      callRelay: async () => {
        relayCalled = true;
        return { images: [{ b64_json: TINY_PNG_B64 }] };
      },
      putToR2: async (_uid: string, gid: string): Promise<PutResult> => ({
        storageKey: `mtest/${gid}.png`,
        publicUrl: `https://img.test/${gid}.png`,
        contentType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: 70,
      }),
    };
    const outcome = await runGenerationJob(generationId, deps);
    expect(outcome).toBe("failed");
    expect(relayCalled).toBe(false); // 参考图丢失 → 不调中转
    const g = await ctx.gen(generationId);
    expect(g?.error_code).toBe("invalid_request");
    expect(await ctx.balanceMp(uid)).toBe(140); // 未扣
  });

  it("对话结果编辑：服务端来源字节走 edits，原图保留且 system 只扣一次", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE * 2 });
    await ctx.addLot(uid, PRICE * 2, { source: "signup" });
    const source = await createStoredSource(uid);
    const generationId = await createSourceEdit(uid, source.imageId);
    let readKey: string | null = null;
    let sawInput = false;

    const outcome = await runGenerationJob(generationId, {
      getStoredImageObject: async (storageKey: string) => {
        readKey = storageKey;
        return {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          filename: "source.png",
        };
      },
      callRelay: async (request) => {
        sawInput = Boolean(request.inputImage);
        return { images: [{ b64_json: TINY_PNG_B64 }] };
      },
      putToR2: async (_userId, childId): Promise<PutResult> => ({
        storageKey: `mtest/${childId}.png`,
        publicUrl: `https://img.test/${childId}.png`,
        contentType: "image/png",
        width: 1,
        height: 1,
        sizeBytes: 70,
      }),
    });

    expect(outcome).toBe("succeeded");
    expect(readKey).toBe(source.storageKey);
    expect(sawInput).toBe(true);
    expect(await ctx.images(source.generationId)).toHaveLength(1);
    expect(await ctx.images(generationId)).toHaveLength(1);
    expect(Number((await ctx.gen(generationId))?.credits_charged_mp)).toBe(PRICE);
    expect(await ctx.balanceMp(uid)).toBe(PRICE);
    expect(Number((await ctx.lots(uid))[0]?.remaining_mp)).toBe(PRICE);
    const debits = await ctx.ledger(uid, "debit");
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({ ref_id: generationId });
    expect(Number(debits[0].amount_mp)).toBe(PRICE);
    expect(Number(debits[0].balance_after_mp)).toBe(PRICE);
  });

  it("对话结果编辑：来源记录在入队后删除时明确失败且不扣费", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE * 2 });
    await ctx.addLot(uid, PRICE * 2, { source: "signup" });
    const source = await createStoredSource(uid);
    const generationId = await createSourceEdit(uid, source.imageId);
    await ctx.sql`DELETE FROM images WHERE id=${source.imageId}`;
    let relayCalled = false;

    expect(
      await runGenerationJob(generationId, {
        callRelay: async () => {
          relayCalled = true;
          return { images: [{ b64_json: TINY_PNG_B64 }] };
        },
      }),
    ).toBe("failed");
    expect(relayCalled).toBe(false);
    expect((await ctx.gen(generationId))?.error_code).toBe("source_image_unavailable");
    expect(await ctx.images(generationId)).toHaveLength(0);
    expect(await ctx.balanceMp(uid)).toBe(PRICE * 2);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
  });

  it("对话结果编辑：来源对象不可读时明确失败且不扣费", async () => {
    const uid = await ctx.createUser({ balanceMp: PRICE * 2 });
    await ctx.addLot(uid, PRICE * 2, { source: "signup" });
    const source = await createStoredSource(uid);
    const generationId = await createSourceEdit(uid, source.imageId);
    let relayCalled = false;

    expect(
      await runGenerationJob(generationId, {
        getStoredImageObject: async () => {
          throw new Error("NoSuchKey");
        },
        callRelay: async () => {
          relayCalled = true;
          return { images: [{ b64_json: TINY_PNG_B64 }] };
        },
      }),
    ).toBe("failed");
    expect(relayCalled).toBe(false);
    expect((await ctx.gen(generationId))?.error_code).toBe("source_image_unavailable");
    expect(await ctx.images(generationId)).toHaveLength(0);
    expect(await ctx.balanceMp(uid)).toBe(PRICE * 2);
    expect(await ctx.ledger(uid, "debit")).toHaveLength(0);
  });

  it("中转失败：归一化 failed、未扣费、无 image", async () => {
    const uid = await ctx.createUser({ balanceMp: 140 });
    await ctx.addLot(uid, 140, { source: "signup" });
    const { generationId } = await ctx.createGeneration(uid, { status: "queued" });

    const failingDeps: ProcessDeps = {
      callRelay: async () => {
        const e = new Error("503 upstream unavailable") as Error & { httpStatus?: number };
        e.httpStatus = 503;
        throw e;
      },
    };
    const outcome = await runGenerationJob(generationId, failingDeps);
    expect(outcome).toBe("failed");
    const g = await ctx.gen(generationId);
    expect(g?.status).toBe("failed");
    expect(g?.error_code).toBe("relay_5xx");
    expect(Number(g?.http_status)).toBe(503);
    expect(await ctx.balanceMp(uid)).toBe(140); // 未扣（失败不进扣费事务）
    expect((await ctx.images(generationId)).length).toBe(0);
  });
});
