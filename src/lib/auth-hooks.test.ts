import { beforeEach, describe, expect, it, vi } from "vitest";
const sql = vi.hoisted(() => vi.fn());
const grant = vi.hoisted(() => vi.fn());
vi.mock("../db/db.server", () => ({ getSql: () => sql }));
vi.mock("../server/money/grant.server", () => ({ grantSignup: grant }));
import { onSessionCreated, onUserRegistered } from "./auth-hooks";

beforeEach(() => { sql.mockReset(); grant.mockReset(); sql.mockResolvedValue([]); });
describe("administrative identity hooks after billing retirement", () => {
  it("creates only the ownership row during administrator bootstrap", async () => {
    await onUserRegistered({ id: "owner-id", email: "admin@example.test" });
    expect(grant).not.toHaveBeenCalled();
    expect(sql.mock.calls.map(([parts]) => parts.join("?")).join(" ")).toContain("INSERT INTO users");
    expect(sql.mock.calls.map(([parts]) => parts.join("?")).join(" ")).not.toMatch(/credit_|ledger|budget/);
  });
  it("never grants credit on session creation", async () => {
    sql.mockResolvedValueOnce([{ id: "owner-id", email: "admin@example.test" }]);
    await onSessionCreated({ userId: "owner-id" });
    expect(grant).not.toHaveBeenCalled();
    expect(sql.mock.calls.map(([parts]) => parts.join("?")).join(" ")).not.toMatch(/credit_|ledger|budget/);
  });
});
