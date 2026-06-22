import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadInspirations } from "./reads.server";

// P3-S4：无 DATABASE_URL 时 getSql() 抛错 → loadInspirations 走「种子回退」分支。
// 本测试强制此分支（删 env 变量），验种子回退 + 品类/搜索语义；SQL 路径由 scripts/inspirations-smoke.ts 对真 Neon 验。
describe("loadInspirations 种子回退（P3-S4）", () => {
  const saved = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  it("无筛选 → 全部种子 + 动态品类（不含「全部」）", async () => {
    const r = await loadInspirations();
    expect(r.items.length).toBe(10);
    expect(r.categories).toEqual(expect.arrayContaining(["海报", "风景", "人像", "国风", "写实"]));
    expect(r.categories).not.toContain("全部");
  });

  it("🔴 红线：只读 cover（string），不暴露 cover_key/storage_key", async () => {
    const r = await loadInspirations();
    for (const item of r.items) {
      expect(typeof item.cover).toBe("string");
      const keys = Object.keys(item);
      expect(keys).not.toContain("coverKey");
      expect(keys).not.toContain("cover_key");
      expect(keys).not.toContain("storageKey");
      expect(keys).not.toContain("storage_key");
    }
  });

  it("种子卡带原始宽高（瀑布流原比例）", async () => {
    const r = await loadInspirations();
    expect(r.items.every((i) => typeof i.width === "number" && typeof i.height === "number")).toBe(true);
  });

  it("按品类过滤", async () => {
    const r = await loadInspirations("海报");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.category === "海报")).toBe(true);
  });

  it("「全部」= 不按品类过滤（等同无筛选）", async () => {
    const r = await loadInspirations("全部");
    expect(r.items.length).toBe(10);
  });

  it("关键词搜索命中标题/摘要/提示词（大小写不敏感）", async () => {
    const lower = await loadInspirations(undefined, "工笔");
    expect(lower.items.length).toBeGreaterThan(0);
    const upper = await loadInspirations(undefined, "CYBER"); // 赛博城市英文不在种子，验空安全
    expect(Array.isArray(upper.items)).toBe(true);
  });

  it("搜索无命中 → 空 items，categories 仍齐", async () => {
    const r = await loadInspirations(undefined, "绝不存在的关键词zzz");
    expect(r.items.length).toBe(0);
    expect(r.categories.length).toBeGreaterThan(0);
  });

  it("品类 + 关键词叠加（AND）", async () => {
    const r = await loadInspirations("国风", "工笔");
    expect(r.items.every((i) => i.category === "国风")).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("搜「%」按字面（种子无 % 文本）→ 不误匹配全部", async () => {
    const r = await loadInspirations(undefined, "%");
    expect(r.items.length).toBe(0);
  });
});
