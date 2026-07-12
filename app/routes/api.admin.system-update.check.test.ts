// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "./api.admin.system-update.check";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  checkLatestStableRelease: vi.fn(),
  createSystemUpdateRequest: vi.fn(),
  getCurrentBuild: vi.fn(),
  readSystemUpdateStatus: vi.fn(),
  requireAdmin: vi.fn(),
  writeAuditHttp: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {},
  access: mocks.access,
  link: vi.fn(),
  lstat: vi.fn(),
  open: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("../../src/lib/guard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("../../src/server/admin/audit.server", () => ({ writeAuditHttp: mocks.writeAuditHttp }));
vi.mock("../../src/server/system-update/version.server", () => ({
  getCurrentBuild: mocks.getCurrentBuild,
}));
vi.mock("../../src/server/system-update/github-release.server", () => ({
  checkLatestStableRelease: mocks.checkLatestStableRelease,
}));
vi.mock("../../src/server/system-update/state.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/system-update/state.server")>()),
  createSystemUpdateRequest: mocks.createSystemUpdateRequest,
  readSystemUpdateStatus: mocks.readSystemUpdateStatus,
}));

const build = { version: "0.2.0", commitSha: "unknown", shortCommitSha: "unknown" };
const status = {
  protocolVersion: 1,
  requestId: null,
  currentVersion: "0.2.0",
  targetVersion: null,
  phase: "idle",
  maintenance: false,
  startedAt: null,
  finishedAt: null,
  updatedAt: "2026-07-12T10:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  backupId: null,
  recoveryCommand: null,
};
const release = {
  tag: "v0.3.0",
  version: "0.3.0",
  name: "Version 0.3.0",
  summary: "Stable release",
  htmlUrl: "https://github.com/Ttt599536561/image-2/releases/tag/v0.3.0",
  publishedAt: "2026-07-12T10:00:00.000Z",
};

function checkRequest(headers: Record<string, string> = {}) {
  return new Request("https://images.example.com/api/admin/system-update/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://images.example.com",
      ...headers,
    },
    body: "{}",
  });
}

async function expectError(response: Response, statusCode: number, code: string) {
  expect(response.status).toBe(statusCode);
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe("admin forced system update check route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://images.example.com";
    mocks.requireAdmin.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000002",
      role: "admin",
      maxConcurrency: 4,
    });
    mocks.getCurrentBuild.mockReturnValue(build);
    mocks.readSystemUpdateStatus.mockResolvedValue(status);
    mocks.access.mockResolvedValue(undefined);
    mocks.checkLatestStableRelease.mockResolvedValue({ state: "available", release });
  });

  it("runs security before authentication", async () => {
    const response = await action({
      request: checkRequest({ "Content-Type": "text/plain" }),
    } as never);

    await expectError(response, 415, "INVALID_PARAM");
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("passes through non-admin responses", async () => {
    const forbidden = Response.json({ error: { code: "FORBIDDEN", message: "no" } }, { status: 403 });
    mocks.requireAdmin.mockRejectedValue(forbidden);

    expect(await action({ request: checkRequest() } as never)).toBe(forbidden);
  });

  it.each([
    ["missing", null],
    ["mismatch", { ...status, currentVersion: "0.1.0" }],
  ])("rejects %s updater state", async (_name, updaterStatus) => {
    mocks.readSystemUpdateStatus.mockResolvedValue(updaterStatus);

    await expectError(await action({ request: checkRequest() } as never), 503, "UPDATE_UNAVAILABLE");
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
  });

  it("sanitizes malformed state and unwritable inbox failures", async () => {
    mocks.readSystemUpdateStatus.mockRejectedValueOnce(new Error("raw state payload"));
    await expectError(await action({ request: checkRequest() } as never), 503, "UPDATE_UNAVAILABLE");

    mocks.readSystemUpdateStatus.mockResolvedValueOnce(status);
    mocks.access.mockRejectedValueOnce(new Error("raw filesystem path"));
    await expectError(await action({ request: checkRequest() } as never), 503, "UPDATE_UNAVAILABLE");
  });

  it.each([
    [{ state: "none", release: null }, "none", null],
    [{ state: "up_to_date", release }, "up_to_date", release],
    [{ state: "available", release }, "available", release],
  ])("returns the strict snapshot for %s", async (result, releaseState, latestRelease) => {
    mocks.checkLatestStableRelease.mockResolvedValue(result);

    const response = await action({ request: checkRequest() } as never);



    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      disabledReason: null,
      build,
      status,
      releaseState,
      latestRelease,
    });
    expect(mocks.checkLatestStableRelease).toHaveBeenCalledWith({
      currentVersion: "0.2.0",
      force: true,
    });
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
  });

  it("sanitizes GitHub failures", async () => {
    mocks.checkLatestStableRelease.mockRejectedValue(new Error("raw GitHub response"));

    await expectError(await action({ request: checkRequest() } as never), 503, "UPDATE_UNAVAILABLE");
  });
});
