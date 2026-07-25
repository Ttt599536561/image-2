// @vitest-environment node
// F-073：loadLandingGallery —— /welcome 首页画廊读取。
// 覆盖：①DB 行 → 正确映射（只暴露 image_url，绝不暴露 image_key；prompt 空串兜底；submitter 恒 null）；
// ②无 active 行 → null（调用方回退灵感库）；③DB 不可达/表未建 → null（不抛错，门面永不空）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  throwOnQuery: null as Error | null,
}));

vi.mock("../../src/db/db.server", () => ({
  getSql: () => {
    return () => {
      if (mocks.throwOnQuery) return Promise.reject(mocks.throwOnQuery);
      return Promise.resolve(mocks.rows);
    };
  },
}));

import { loadLandingGallery } from "./reads.server";

const baseRow = {
  id: "22222222-2222-4222-8222-000000000001",
  image_url: "https://cdn.example.test/media/landing/2026/07/a.png",
  image_key: "landing/2026/07/a.png", // 🔴 绝不下发
  title: "山间晨雾",
  summary: "写实风景",
  prompt: "清晨山间薄雾，写实摄影",
  category: "风景",
  width: 1536,
  height: 1024,
};

describe("loadLandingGallery（F-073）", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.throwOnQuery = null;
  });

  it("有 active 卡 → 映射为前台形状，submitter 恒 null", async () => {
    mocks.rows = [baseRow];
    const items = await loadLandingGallery();
    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
    expect(items![0]).toEqual({
      id: baseRow.id,
      cover: baseRow.image_url,
      title: "山间晨雾",
      summary: "写实风景",
      prompt: "清晨山间薄雾，写实摄影",
      category: "风景",
      width: 1536,
      height: 1024,
      submitter: null,
    });
  });

  it("🔴 红线：只读 image_url，不暴露 image_key/storage_key", async () => {
    mocks.rows = [baseRow];
    const items = await loadLandingGallery();
    for (const item of items ?? []) {
      const keys = Object.keys(item);
      expect(keys).not.toContain("image_key");
      expect(keys).not.toContain("imageKey");
      expect(keys).not.toContain("storage_key");
      expect(keys).not.toContain("storageKey");
    }
  });

  it("prompt/宽高为 NULL 时兜底（空串 / null）", async () => {
    mocks.rows = [{ ...baseRow, prompt: null, width: null, height: null, summary: null, category: null }];
    const items = await loadLandingGallery();
    expect(items![0].prompt).toBe("");
    expect(items![0].width).toBeNull();
    expect(items![0].height).toBeNull();
    expect(items![0].summary).toBeNull();
    expect(items![0].category).toBeNull();
  });

  it("无 active 卡 → null（welcome 回退灵感库）", async () => {
    mocks.rows = [];
    expect(await loadLandingGallery()).toBeNull();
  });

  it("DB 不可达/表未建 → null（不抛错，门面永不空）", async () => {
    mocks.throwOnQuery = new Error('relation "landing_gallery_items" does not exist');
    expect(await loadLandingGallery()).toBeNull();
  });
});
