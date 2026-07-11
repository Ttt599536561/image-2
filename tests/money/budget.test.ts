// 单日预算硬上限真库用例（铁律① · 04 §5.6 / §11.10 命门补强）：带阈值条件原子自增防 TOCTOU 击穿。
// N 个并发 incCallIfUnderCap 在 cap 处恰好 cap 个成功、其余被拒（绝不冲过）。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { budgetTodayKey, cleanupBudgetKeys, incCallIfUnderCap, incMs } from "../../src/server/budget.server";
import { type TestCtx, ensureSeedConfig, newCtx } from "./_helpers";

let ctx: TestCtx;
let originalCap: string | null = null;
beforeAll(async () => ensureSeedConfig(newCtx().sql));
beforeEach(async () => {
  ctx = newCtx();
  const r = await ctx.sql`SELECT value_json FROM app_config WHERE key='daily_relay_budget_calls'`;
  originalCap = r.length ? JSON.stringify(r[0].value_json) : null;
});
afterEach(async () => {
  // 还原 cap + 清当日预算键。
  if (originalCap !== null) {
    await ctx.sql`UPDATE app_config SET value_json=${originalCap}::jsonb WHERE key='daily_relay_budget_calls'`;
  }
  await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;
  await ctx.cleanup();
});

describe("单日预算硬上限（budget）", () => {
  it("cap=5 时 12 个并发 incCallIfUnderCap：恰好 5 个 true、7 个 false（无 TOCTOU 击穿）", async () => {
    await ctx.sql`INSERT INTO app_config(key,value_json) VALUES ('daily_relay_budget_calls','5'::jsonb)
                  ON CONFLICT (key) DO UPDATE SET value_json='5'::jsonb`;
    await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`; // 从 0 起

    const results = await Promise.all(Array.from({ length: 12 }, () => incCallIfUnderCap()));
    expect(results.filter((x) => x === true).length).toBe(5);
    expect(results.filter((x) => x === false).length).toBe(7);

    const row = await ctx.sql`SELECT value_json FROM app_config WHERE key=${budgetTodayKey()}`;
    expect(Number((row[0].value_json as { calls: number }).calls)).toBe(5); // 计数恰好停在 cap
  });

  it("incMs 累加（仅监控、不硬挡）", async () => {
    await ctx.sql`DELETE FROM app_config WHERE key=${budgetTodayKey()}`;
    await incMs(1000);
    await incMs(500);
    const row = await ctx.sql`SELECT value_json FROM app_config WHERE key=${budgetTodayKey()}`;
    expect(Number((row[0].value_json as { ms: number }).ms)).toBe(1500);
  });

  it("yesterday duration recomputation excludes custom credential jobs", async () => {
    const [{ d }] = (await ctx.sql`
      SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day', 'YYYY-MM-DD') AS d`) as Array<{
      d: string;
    }>;
    const key = `relay_budget:${d}`;
    const previous = await ctx.sql`SELECT value_json FROM app_config WHERE key=${key}`;
    const userId = await ctx.createUser();
    const system = await ctx.createGeneration(userId, { credentialMode: "system" });
    const custom = await ctx.createGeneration(userId, { credentialMode: "custom" });
    try {
      await ctx.sql`UPDATE generations
                    SET status='succeeded',started_at=now()-interval '1 day',duration_ms=1200
                    WHERE id=${system.generationId}`;
      await ctx.sql`UPDATE generations
                    SET status='succeeded',started_at=now()-interval '1 day',duration_ms=9800
                    WHERE id=${custom.generationId}`;
      await ctx.sql`INSERT INTO app_config(key,value_json) VALUES(${key},'{"calls":1,"ms":0}'::jsonb)
                    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
      expect((await cleanupBudgetKeys()).recomputedMs).toBe(1200);
    } finally {
      if (previous.length > 0) {
        await ctx.sql`INSERT INTO app_config(key,value_json) VALUES(${key},${JSON.stringify(previous[0].value_json)}::jsonb)
                      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
      } else {
        await ctx.sql`DELETE FROM app_config WHERE key=${key}`;
      }
    }
  });
});
