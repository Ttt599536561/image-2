// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), handler: vi.fn(), limited: vi.fn(), failure: vi.fn() }));
vi.mock("../db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("../lib/auth", () => ({ auth: { handler: mocks.handler } }));
vi.mock("./rateLimit", () => ({ clientIp: () => "127.0.0.1", isRateLimited: mocks.limited, recordRateFailure: mocks.failure }));
import { handleAdminAuth } from "./admin-auth.server";

const post = (path: string, body: unknown = {}) => new Request(`https://studio.test/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.sql.mockResolvedValue([]); mocks.limited.mockResolvedValue(false); mocks.failure.mockResolvedValue(undefined); mocks.handler.mockResolvedValue(Response.json({ user: { role: "admin" } })); });
describe("administrator-only HTTP authentication", () => {
  it.each(["sign-up/email", "forget-password", "reset-password", "admin/create-user", "change-password"])("disables %s before reading credentials", async (path) => {
    expect((await handleAdminAuth(post(path))).status).toBe(404);
    expect(mocks.handler).not.toHaveBeenCalled(); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("refuses ordinary account login without creating an auth session", async () => {
    const response = await handleAdminAuth(post("sign-in/email", { email: "user@example.test", password: "secret" }));
    expect(response.status).toBe(401); expect(mocks.handler).not.toHaveBeenCalled(); expect(mocks.failure).toHaveBeenCalled();
  });
  it("allows an existing administrator and preserves the request body", async () => {
    mocks.sql.mockResolvedValue([{ id: "admin" }]);
    expect((await handleAdminAuth(post("sign-in/email", { email: "admin@example.test", password: "secret" }))).status).toBe(200);
    expect(await mocks.handler.mock.calls[0][0].json()).toMatchObject({ email: "admin@example.test", password: "secret" });
  });
  it("rejects an oversized body before querying authentication", async () => {
    expect((await handleAdminAuth(post("sign-in/email", { email: "a".repeat(20000) }))).status).toBe(413);
    expect(mocks.handler).not.toHaveBeenCalled(); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("does not expose ordinary user sessions through the administrative session endpoint", async () => {
    mocks.handler.mockResolvedValue(Response.json({ user: { role: "user" }, session: { token: "secret" } }));
    expect(await (await handleAdminAuth(new Request("https://studio.test/api/auth/get-session"))).json()).toBeNull();
  });
});
