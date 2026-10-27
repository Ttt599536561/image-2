// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), sql: vi.fn(), release: vi.fn() }));
vi.mock("../db/db.server", () => ({
  getSql: () => db.sql,
  getPool: () => ({ connect: async () => ({ query: db.query, release: db.release }) }),
}));
import { reorderProjects, reorderProjectConversations } from "./projects.server";

beforeEach(() => {
  vi.clearAllMocks();
  db.sql.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
});

describe("project sorting transaction", () => {
  it("rolls back instead of committing when the bulk update fails", async () => {
    db.query.mockImplementation(async (text: string) => {
      if (text.includes("UPDATE projects")) throw new Error("write failed");
      return { rows: [{ id: "p1" }, { id: "p2" }], rowCount: 2 };
    });
    await expect(reorderProjects("owner", ["p2", "p1"])).rejects.toThrow("write failed");
    const statements = db.query.mock.calls.map(([text]) => text);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(db.release).toHaveBeenCalledOnce();
  });

  it("rolls back a changed row count so a partial reorder cannot be committed", async () => {
    db.query.mockImplementation(async (text: string) => {
      if (text.includes("UPDATE projects")) return { rows: [], rowCount: 1 };
      return { rows: [{ id: "p1" }, { id: "p2" }], rowCount: 2 };
    });
    await expect(reorderProjects("owner", ["p2", "p1"])).rejects.toThrow();
    expect(db.query.mock.calls.map(([text]) => text)).toContain("ROLLBACK");
    expect(db.query.mock.calls.map(([text]) => text)).not.toContain("COMMIT");
  });

  it("rolls back a partial conversation reorder", async () => {
    db.sql.mockResolvedValueOnce([{ id: "p1" }]).mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);
    db.query.mockImplementation(async (text: string) => {
      if (text.includes("UPDATE conversations")) return { rows: [], rowCount: 1 };
      if (text.includes("FROM conversations")) return { rows: [{ id: "c1" }, { id: "c2" }], rowCount: 2 };
      return { rows: [{ id: "p1" }], rowCount: 1 };
    });
    await expect(reorderProjectConversations("owner", "p1", ["c2", "c1"])).rejects.toThrow();
    expect(db.query.mock.calls.map(([text]) => text)).toContain("ROLLBACK");
    expect(db.query.mock.calls.map(([text]) => text)).not.toContain("COMMIT");
  });
});
