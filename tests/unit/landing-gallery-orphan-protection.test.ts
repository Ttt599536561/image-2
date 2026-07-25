// @vitest-environment node
// F-073 高危点：首页画廊上传图（landing/…）必须进孤儿清理 known-set，
// 否则超过 1h 保护窗口后会被 sweepOrphanR2Objects 当孤儿删掉 = 门面丢图。
// 本测试 mock getSql：①断言 known-set SQL 确含 landing_gallery_items UNION（防回归删 UNION）；
// ②端到端验证「在 known-set 的 landing key 不删、不在的才删、1h 窗口内不碰」。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capturedSql: [] as string[],
  knownKeys: new Set<string>(),
}));

vi.mock("../../src/db/db.server", () => ({
  getSql: () => {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      mocks.capturedSql.push(text);
      // known-set UNION 查询：返回预置的 known key（模拟 DB 命中）
      if (text.includes("landing_gallery_items") || text.includes("FROM images")) {
        return Promise.resolve([...mocks.knownKeys].map((k) => ({ k })));
      }
      return Promise.resolve([]); // INSERT INTO events 等
    };
  },
}));

import { sweepOrphanR2Objects } from "../../src/server/maintenance.server";

const HOUR = 3_600_000;

describe("sweepOrphanR2Objects 首页画廊保护（F-073）", () => {
  beforeEach(() => {
    mocks.capturedSql.length = 0;
    mocks.knownKeys = new Set(["landing/2026/07/keep.png"]);
  });

  it("known-set SQL 包含 landing_gallery_items.image_key（UNION 防回归）", async () => {
    await sweepOrphanR2Objects({ listObjects: async () => [], deleteMany: async () => [] });
    // 无老对象时不会发起比对 → 造一个老对象触发查询
    mocks.capturedSql.length = 0;
    await sweepOrphanR2Objects({
      listObjects: async () => [{ key: "landing/2026/07/keep.png", lastModified: Date.now() - 2 * HOUR }],
      deleteMany: async () => [],
    });
    const unionQuery = mocks.capturedSql.find((q) => q.includes("UNION"));
    expect(unionQuery).toBeDefined();
    expect(unionQuery).toContain("landing_gallery_items");
  });

  it("在用 landing 图不删、失效 landing 图才删、1h 窗口内不碰", async () => {
    const now = Date.now();
    const deleted: string[][] = [];
    const r = await sweepOrphanR2Objects({
      listObjects: async () => [
        { key: "landing/2026/07/keep.png", lastModified: now - 2 * HOUR }, // 在用（known-set 命中）→ 保护
        { key: "landing/2026/07/gone.png", lastModified: now - 2 * HOUR }, // 已不在库 → 孤儿，删
        { key: "landing/2026/07/fresh.png", lastModified: now - 1000 }, // 1h 保护窗口内 → 不碰
      ],
      deleteMany: async (keys: string[]) => {
        deleted.push(keys);
        return [];
      },
    });
    expect(deleted).toEqual([["landing/2026/07/gone.png"]]);
    expect(r.orphansDeleted).toBe(1);
  });
});
