// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), pg: vi.fn() }));
vi.mock("../../db/db.server", () => ({ getSql: () => mocks.sql, usesPgDriver: mocks.pg }));
import { claimNext } from "./preempt.server";

beforeEach(() => { vi.resetAllMocks(); mocks.pg.mockReturnValue(false); });
it("keeps the optional Neon HTTP driver on the by-ID CAS path when a contender wins", async () => {
  mocks.sql.mockResolvedValueOnce([{ id: "job" }]).mockResolvedValueOnce([]);
  expect(await claimNext("worker")).toBeNull();
  expect(mocks.sql).toHaveBeenCalledTimes(2);
  expect(mocks.sql.mock.calls[0][0].join("")).toContain("ORDER BY created_at,id");
  expect(mocks.sql.mock.calls[1][0].join("")).toContain("status='queued' AND deadline_at>now()");
  expect(mocks.sql.mock.calls[1].slice(1)).toEqual(["worker", "job"]);
});
it("returns no task for an empty optional driver queue", async () => {
  mocks.sql.mockResolvedValue([]);
  expect(await claimNext()).toBeNull();
  expect(mocks.sql).toHaveBeenCalledOnce();
});
