// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), loadImages: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ requireUser: mocks.requireUser, requireUserStrict: vi.fn() }));
vi.mock("../../src/server/reads.server", () => ({ loadImages: mocks.loadImages, deleteImages: vi.fn() }));
import { loader } from "./api.images";
import type { Route } from "./+types/api.images";

function request(query = "") {
  return loader({ request: new Request(`https://example.test/api/images${query}`) } as Route.LoaderArgs);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: "user-1" });
  mocks.loadImages.mockResolvedValue({ items: [], total: 0 });
});

describe("asset pagination", () => {
  it.each(["Infinity", "-Infinity", "NaN", "-1", "0", "1.5", "abc", "", " "])(
    "rejects invalid page %s before loading images", async (value) => {
      const response = await request(`?page=${encodeURIComponent(value)}`);
      expect(response.status).toBe(400);
      expect(mocks.loadImages).not.toHaveBeenCalled();
    },
  );
  it.each(["Infinity", "-1", "0", "2.5", "101", "NaN", ""])(
    "rejects invalid pageSize %s", async (value) => {
      const response = await request(`?pageSize=${value}`);
      expect(response.status).toBe(400);
      expect(mocks.loadImages).not.toHaveBeenCalled();
    },
  );
  it("retains defaults when pagination is omitted", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.loadImages).toHaveBeenCalledWith("user-1", expect.objectContaining({
      page: undefined, pageSize: undefined,
    }));
  });
  it("accepts positive integer pages and the pageSize upper boundary with filters", async () => {
    expect((await request("?page=2&pageSize=100&q=cat&range=7d")).status).toBe(200);
    expect(mocks.loadImages).toHaveBeenCalledWith("user-1", expect.objectContaining({
      page: 2, pageSize: 100, q: "cat", range: "7d",
    }));
  });
});
