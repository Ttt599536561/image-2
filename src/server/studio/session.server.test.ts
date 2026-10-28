// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ sql: vi.fn(), query: vi.fn(), rate: vi.fn() }));
vi.mock("../../db/db.server", () => ({ getSql: () => mock.sql }));
vi.mock("../tx.server", () => ({ tx: (fn: Function) => fn({ query: mock.query }) }));
vi.mock("./limits.server", () => ({ consumeStudioRate: mock.rate }));
import { getOrCreateStudioSession, requireStudioSession, STUDIO_COOKIE_NAME } from "./session.server";

describe("anonymous session ownership", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => { mock.sql.mockReset().mockResolvedValue([]); mock.query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 }); mock.rate.mockReset().mockResolvedValue(undefined); });
  it("rejects sensitive reads without minting an owner", async () => {
    await expect(requireStudioSession(new Request("https://studio.example"))).rejects.toMatchObject({ status: 401 });
    expect(mock.query).not.toHaveBeenCalled();
    expect(mock.sql).not.toHaveBeenCalled();
  });
  it("marks production cookies Secure and does not attach a Domain", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const session = await getOrCreateStudioSession(new Request("http://studio.example"));
    expect(session.cookie).toContain("; Secure");
    expect(session.cookie).not.toContain("Domain=");
  });
  it("only stores a SHA256 digest and creates no auth or money rows", async () => {
    const result = await getOrCreateStudioSession(new Request("https://studio.example"));
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Max-Age=7776000");
    const token = result.cookie!.match(/^[^=]+=([^;]+)/)![1];
    expect(token).toMatch(/^[\w-]{43}$/);
    const statements = mock.query.mock.calls;
    expect(statements.map(([sql]) => sql).join(" ")).not.toMatch(/credit|ledger|"user"|"session"/);
    expect(statements.find(([sql]) => sql.includes("INSERT INTO studio_sessions"))![1][0]).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(statements)).not.toContain(token);
  });
  it("restores only a live nonbanned owned session from its hash", async () => {
    mock.sql.mockResolvedValue([{ user_id: "owner", expires_at: new Date(Date.now() + 3600000) }]);
    const request = new Request("https://studio.example", { headers: { cookie: `${STUDIO_COOKIE_NAME}=${"a".repeat(43)}` } });
    expect(await requireStudioSession(request)).toEqual({ userId: "owner", maxConcurrency: 10 });
    expect(mock.sql.mock.calls[0][0].join("?")).toContain("is_banned=false");
    expect(mock.sql.mock.calls[0][1]).not.toBe("a".repeat(43));
    expect(mock.query).not.toHaveBeenCalled();
  });
});
