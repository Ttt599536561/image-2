// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expireDueGenerations: vi.fn(),
  deleteExpiredGenerationCredentials: vi.fn(),
  captureException: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("../../src/server/generation/deadline.server", () => ({
  expireDueGenerations: mocks.expireDueGenerations,
}));
vi.mock("../../src/server/generation/credential.server", () => ({
  deleteExpiredGenerationCredentials: mocks.deleteExpiredGenerationCredentials,
}));
vi.mock("../../src/server/sentry.server", () => ({ captureException: mocks.captureException }));
vi.mock("../../src/server/alert.server", () => ({ alert: mocks.alert }));

import handler from "../../netlify/functions/cron-clean-generation-credentials";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.expireDueGenerations.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mocks.deleteExpiredGenerationCredentials.mockResolvedValue(3);
  mocks.captureException.mockResolvedValue(undefined);
  mocks.alert.mockResolvedValue(undefined);
});

describe("generation credential cleanup cron", () => {
  it("reports expired jobs and deleted credentials", async () => {
    const response = await handler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, expiredJobs: 2, deletedCredentials: 3 });
  });

  it("captures and alerts once without exposing the underlying error", async () => {
    const sentinel = "fictional-cron-error-sentinel";
    mocks.expireDueGenerations.mockRejectedValue(new Error(sentinel));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handler();
    const responseText = await response.text();
    expect(response.status).toBe(500);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.alert).toHaveBeenCalledWith("cron_failed", {
      cron: "clean-generation-credentials",
    });
    expect(responseText).not.toContain(sentinel);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(sentinel);
    consoleSpy.mockRestore();
  });
});
