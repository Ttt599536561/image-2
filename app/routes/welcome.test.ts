// F-073：/welcome loader 回退链 —— 管理员配置的首页画廊优先；未配置回退灵感库（再回退种子）；
// 已登录闭环重定向回 /（F-072 不回归）。（jsdom 环境：路由模块会连带 import LandingPage 组件链。）
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  loadLandingGallery: vi.fn(),
  loadInspirations: vi.fn(),
}));

vi.mock("../../src/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("../../src/server/reads.server", () => ({
  loadLandingGallery: mocks.loadLandingGallery,
  loadInspirations: mocks.loadInspirations,
}));

import { loader } from "./welcome";
import type { Route } from "./+types/welcome";

function callLoader() {
  return loader({ request: new Request("https://example.test/welcome") } as unknown as Route.LoaderArgs);
}

function makeItem(id: string) {
  return {
    id,
    cover: `https://cdn.example.test/${id}.png`,
    title: `图 ${id}`,
    summary: null,
    prompt: "",
    category: null,
    width: 1024,
    height: 1024,
    submitter: null,
  };
}

describe("/welcome loader（F-073 回退链）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null); // 未登录
  });

  it("已登录 → 302 回 /（F-072 闭环不回归）", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    const err = await callLoader().catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(302);
    expect((err as Response).headers.get("Location")).toBe("/");
  });

  it("管理员已配置首页画廊 → 原样返回（不截断、不读灵感库）", async () => {
    const landing = Array.from({ length: 16 }, (_, i) => makeItem(`landing-${i}`));
    mocks.loadLandingGallery.mockResolvedValue(landing);
    const data = await callLoader();
    expect(data.items).toHaveLength(16);
    expect(data.items[0].id).toBe("landing-0");
    expect(mocks.loadInspirations).not.toHaveBeenCalled();
  });

  it("未配置（null）→ 回退灵感库并截断到 14", async () => {
    mocks.loadLandingGallery.mockResolvedValue(null);
    mocks.loadInspirations.mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) => makeItem(`insp-${i}`)),
      categories: [],
    });
    const data = await callLoader();
    expect(mocks.loadInspirations).toHaveBeenCalledTimes(1);
    expect(data.items).toHaveLength(14);
    expect(data.items[0].id).toBe("insp-0");
  });
});
