import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), runGenerationJob: vi.fn() }));
vi.mock("../../db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("./process", () => ({ runGenerationJob: mocks.runGenerationJob }));

import { runWorkerIteration } from "./worker.server";

describe("generation worker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("processes queued ids up to the configured concurrency", async () => {
    mocks.sql.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    mocks.runGenerationJob.mockResolvedValue("succeeded");
    expect(await runWorkerIteration(2)).toBe(2);
    expect(mocks.runGenerationJob).toHaveBeenCalledTimes(2);
  });
});
