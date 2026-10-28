import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadMe: vi.fn(), loadConversations: vi.fn(), loadProjects: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("../../src/server/page.server", () => ({ requireUserPage: async () => ({ userId: "user-1" }) }));
vi.mock("../../src/server/reads.server", () => ({ loadMe: mocks.loadMe, loadConversations: mocks.loadConversations }));
vi.mock("../../src/server/projects.server", () => ({ loadProjects: mocks.loadProjects }));
import { loader } from "./_app";
import type { Route } from "./+types/_app";

beforeEach(() => vi.clearAllMocks());
it("loads the shell from me and projects without the duplicate legacy conversation list", async () => {
  mocks.loadMe.mockResolvedValue({ user: { id: "user-1" } });
  mocks.loadProjects.mockResolvedValue({ items: [] });
  const data = await loader({ request: new Request("https://example.test/assets") } as Route.LoaderArgs);
  expect(data).toEqual({ me: { user: { id: "user-1" } }, projects: { items: [] } });
  expect(mocks.loadConversations).not.toHaveBeenCalled();
  expect(mocks.loadMe).toHaveBeenCalledWith("user-1");
  expect(mocks.loadProjects).toHaveBeenCalledWith("user-1");
});
