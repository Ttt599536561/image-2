// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UPDATE_START_RESERVATION_TTL_MS,
  UpdateStartReservationConflictError,
  UpdateStartReservationLostError,
  UpdateRequestConflictError,
  UpdateRequestPublicationUncertainError,
} from "../../src/server/system-update/state.server";
import { action, loader } from "./api.admin.system-update";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  assertSystemUpdateReservationOwned: vi.fn(),
  checkLatestStableRelease: vi.fn(),
  clientIp: vi.fn(),
  createSystemUpdateReservation: vi.fn(),
  createSystemUpdateRequest: vi.fn(),
  getCurrentBuild: vi.fn(),
  handoffSystemUpdateReservation: vi.fn(),
  randomUUID: vi.fn(),
  readSystemUpdateStatus: vi.fn(),
  releaseSystemUpdateReservation: vi.fn(),
  requireAdmin: vi.fn(),
  writeAuditHttp: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomUUID: mocks.randomUUID,
}));

vi.mock("node:fs/promises", () => ({
  default: {},
  access: mocks.access,
  link: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  rmdir: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock("../../src/lib/guard", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("../../src/server/rateLimit", () => ({ clientIp: mocks.clientIp }));
vi.mock("../../src/server/admin/audit.server", () => ({ writeAuditHttp: mocks.writeAuditHttp }));
vi.mock("../../src/server/system-update/version.server", () => ({
  getCurrentBuild: mocks.getCurrentBuild,
}));
vi.mock("../../src/server/system-update/github-release.server", () => ({
  checkLatestStableRelease: mocks.checkLatestStableRelease,
}));
vi.mock("../../src/server/system-update/state.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/system-update/state.server")>()),
  assertSystemUpdateReservationOwned: mocks.assertSystemUpdateReservationOwned,
  createSystemUpdateReservation: mocks.createSystemUpdateReservation,
  createSystemUpdateRequest: mocks.createSystemUpdateRequest,
  readSystemUpdateStatus: mocks.readSystemUpdateStatus,
  handoffSystemUpdateReservation: mocks.handoffSystemUpdateReservation,
  releaseSystemUpdateReservation: mocks.releaseSystemUpdateReservation,
}));

const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const build = {
  version: "0.2.0",
  commitSha: "unknown",
  shortCommitSha: "unknown",
};
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

function leaseFor(reservationValue: {
  requestId: string;
  expiresAt: string;
}) {
  return {
    requestId: reservationValue.requestId,
    directoryPath: "/run/ai-image-workshop-updater/inbox/.start-reservation",
    tokenPath: `/run/ai-image-workshop-updater/inbox/.start-reservation/${reservationValue.requestId}.json`,
    expiresAt: Date.parse(reservationValue.expiresAt),
    handle: {},
  };
}

function startRequest(body: unknown = { action: "start" }, headers: Record<string, string> = {}) {
  return new Request("https://images.example.com/api/admin/system-update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://images.example.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function expectError(response: Response, statusCode: number, code: string) {
  expect(response.status).toBe(statusCode);
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe("admin system update status/start route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BETTER_AUTH_URL = "https://images.example.com";
    mocks.requireAdmin.mockResolvedValue({
      userId: ADMIN_ID,
      role: "admin",
      maxConcurrency: 4,
    });
    mocks.getCurrentBuild.mockReturnValue(build);
    mocks.readSystemUpdateStatus.mockResolvedValue(status);
    mocks.access.mockResolvedValue(undefined);
    mocks.checkLatestStableRelease.mockResolvedValue({ state: "available", release });
    mocks.writeAuditHttp.mockResolvedValue(undefined);
    mocks.createSystemUpdateReservation.mockImplementation(
      async (reservationValue) => leaseFor(reservationValue),
    );
    mocks.createSystemUpdateRequest.mockResolvedValue(undefined);
    mocks.assertSystemUpdateReservationOwned.mockResolvedValue(undefined);
    mocks.handoffSystemUpdateReservation.mockResolvedValue(undefined);
    mocks.releaseSystemUpdateReservation.mockResolvedValue(undefined);
    mocks.clientIp.mockReturnValue("203.0.113.9");
    mocks.randomUUID.mockReturnValue(REQUEST_ID);
  });

  it("passes through a non-admin loader response before reading updater state", async () => {
    const forbidden = Response.json({ error: { code: "FORBIDDEN", message: "no" } }, { status: 403 });
    mocks.requireAdmin.mockRejectedValue(forbidden);

    const response = await loader({ request: new Request("https://images.example.com/api/admin/system-update") } as never);


    expect(response).toBe(forbidden);
    expect(mocks.getCurrentBuild).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateReservation).not.toHaveBeenCalled();
    expect(mocks.readSystemUpdateStatus).not.toHaveBeenCalled();
  });

  it("returns an unchecked enabled snapshot without calling GitHub", async () => {
    const response = await loader({ request: new Request("https://images.example.com/api/admin/system-update") } as never);


    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      disabledReason: null,
      build,
      status,
      releaseState: "unchecked",
      latestRelease: null,
    });
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
  });

  it("reports a missing updater status as disabled", async () => {
    mocks.readSystemUpdateStatus.mockResolvedValue(null);

    const response = await loader({ request: new Request("https://images.example.com/api/admin/system-update") } as never);
    const snapshot = await response.json();

    expect(snapshot).toMatchObject({ enabled: false, status: null, releaseState: "unchecked" });
    expect(snapshot.disabledReason).toEqual(expect.any(String));
    expect(snapshot.disabledReason.length).toBeGreaterThan(0);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("keeps a valid status but disables the loader when the inbox is unwritable", async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));

    const response = await loader({ request: new Request("https://images.example.com/api/admin/system-update") } as never);

    expect(await response.json()).toMatchObject({ enabled: false, status });
  });

  it("disables the loader with status preserved when build and status versions differ", async () => {
    const mismatchedStatus = { ...status, currentVersion: "0.1.0" };
    mocks.readSystemUpdateStatus.mockResolvedValue(mismatchedStatus);

    const response = await loader({
      request: new Request("https://images.example.com/api/admin/system-update"),
    } as never);
    const snapshot = await response.json();

    expect(snapshot).toMatchObject({ enabled: false, status: mismatchedStatus });
    expect(snapshot.disabledReason).toMatch(/version/i);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("sanitizes malformed status failures", async () => {
    mocks.readSystemUpdateStatus.mockRejectedValue(new Error("secret bad status payload"));

    await expectError(
      await loader({ request: new Request("https://images.example.com/api/admin/system-update") } as never),
      503,
      "UPDATE_UNAVAILABLE",
    );
  });

  it("runs POST security before admin authentication", async () => {
    const response = await action({
      request: startRequest(undefined, { Origin: "https://evil.example.com" }),
    } as never);

    await expectError(response, 403, "FORBIDDEN");
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("passes through a non-admin action response", async () => {
    const forbidden = Response.json({ error: { code: "FORBIDDEN", message: "no" } }, { status: 403 });
    mocks.requireAdmin.mockRejectedValue(forbidden);

    expect(await action({ request: startRequest() } as never)).toBe(forbidden);
  });

  it("passes through a Response thrown while parsing the action body", async () => {
    const thrown = Response.json(
      { error: { code: "MAINTENANCE", message: "busy" } },
      { status: 503 },
    );
    const request = startRequest();
    vi.spyOn(request, "json").mockRejectedValue(thrown);

    expect(await action({ request } as never)).toBe(thrown);
    expect(mocks.getCurrentBuild).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateReservation).not.toHaveBeenCalled();
    expect(mocks.readSystemUpdateStatus).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { action: "check" },
    { action: "start", targetVersion: "0.3.0" },
    { action: "start", repository: "evil/repo" },
  ])("rejects an invalid or extended start body: %j", async (body) => {
    const response = await action({ request: startRequest(body) } as never);

    await expectError(response, 400, "INVALID_PARAM");
    expect(mocks.getCurrentBuild).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateReservation).not.toHaveBeenCalled();
  });

  it("fails closed when the start reservation cannot be created", async () => {
    mocks.createSystemUpdateReservation.mockRejectedValue(new Error("raw reservation path"));

    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");
    expect(mocks.getCurrentBuild).not.toHaveBeenCalled();
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).not.toHaveBeenCalled();
  });

  it("serializes concurrent starts before readiness and GitHub checks", async () => {
    const secondRequestId = "00000000-0000-4000-8000-000000000004";
    let reservationHeld = false;
    mocks.randomUUID
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(secondRequestId);
    mocks.createSystemUpdateReservation.mockImplementation(async (reservationValue) => {
      if (reservationHeld) throw new UpdateStartReservationConflictError();
      reservationHeld = true;
      return leaseFor(reservationValue);
    });
    mocks.releaseSystemUpdateReservation.mockImplementation(async () => {
      reservationHeld = false;
    });

    let finishReleaseCheck!: (value: { state: "available"; release: typeof release }) => void;
    mocks.checkLatestStableRelease.mockImplementationOnce(
      () => new Promise((resolve) => { finishReleaseCheck = resolve; }),
    );

    const first = action({ request: startRequest() } as never);
    await vi.waitFor(() => expect(mocks.checkLatestStableRelease).toHaveBeenCalledOnce());
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();

    const second = await action({ request: startRequest() } as never);
    await expectError(second, 409, "UPDATE_CONFLICT");
    expect(mocks.createSystemUpdateReservation).toHaveBeenCalledTimes(2);
    expect(mocks.readSystemUpdateStatus).toHaveBeenCalledOnce();
    expect(mocks.checkLatestStableRelease).toHaveBeenCalledOnce();
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();

    finishReleaseCheck({ state: "available", release });
    expect((await first).status).toBe(202);
    expect(mocks.writeAuditHttp).toHaveBeenCalledOnce();
    expect(mocks.createSystemUpdateRequest).toHaveBeenCalledOnce();
    expect(mocks.handoffSystemUpdateReservation).toHaveBeenCalledOnce();
    expect(mocks.releaseSystemUpdateReservation).not.toHaveBeenCalled();

    const pendingMarker = await action({ request: startRequest() } as never);
    await expectError(pendingMarker, 409, "UPDATE_CONFLICT");
    expect(mocks.createSystemUpdateReservation).toHaveBeenCalledTimes(3);
    expect(mocks.checkLatestStableRelease).toHaveBeenCalledOnce();
    expect(mocks.createSystemUpdateRequest).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", null],
    ["mismatch", { ...status, currentVersion: "0.1.0" }],
  ])("rejects unavailable or mismatched updater state: %s", async (_name, updaterStatus) => {
    mocks.readSystemUpdateStatus.mockResolvedValue(updaterStatus);

    const response = await action({ request: startRequest() } as never);

    await expectError(response, 503, "UPDATE_UNAVAILABLE");
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("rejects an unwritable inbox before checking GitHub", async () => {
    mocks.access.mockRejectedValue(new Error("denied"));

    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it.each([
    { ...status, phase: "claiming" },
    { ...status, maintenance: true },
  ])("rejects active or maintenance status with a conflict", async (updaterStatus) => {
    mocks.readSystemUpdateStatus.mockResolvedValue(updaterStatus);

    await expectError(await action({ request: startRequest() } as never), 409, "UPDATE_CONFLICT");
    expect(mocks.checkLatestStableRelease).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it.each([
    { state: "none", release: null },
    { state: "up_to_date", release },
  ])("rejects when no newer stable release remains", async (releaseResult) => {
    mocks.checkLatestStableRelease.mockResolvedValue(releaseResult);

    await expectError(await action({ request: startRequest() } as never), 409, "UPDATE_CONFLICT");
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("sanitizes GitHub failures", async () => {
    mocks.checkLatestStableRelease.mockRejectedValue(new Error("GitHub secret payload"));

    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("rejects an invalid available release before audit or publication", async () => {
    mocks.checkLatestStableRelease.mockResolvedValue({
      state: "available",
      release: { ...release, version: "not-a-stable-version" },
    });

    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");
    expect(mocks.writeAuditHttp).not.toHaveBeenCalled();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("audits and publishes the fixed strict request before returning 202", async () => {
    const response = await action({ request: startRequest() } as never);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ requestId: REQUEST_ID, targetVersion: "0.3.0" });
    expect(mocks.checkLatestStableRelease).toHaveBeenCalledWith({
      currentVersion: "0.2.0",
      force: true,
    });
    const reserved = mocks.createSystemUpdateReservation.mock.calls[0][0];
    expect(reserved).toEqual({
      protocolVersion: 1,
      requestId: REQUEST_ID,
      requestedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(reserved.expiresAt) - Date.parse(reserved.requestedAt)).toBe(
      UPDATE_START_RESERVATION_TTL_MS,
    );
    expect(Object.keys(reserved).sort()).toEqual([
      "expiresAt",
      "protocolVersion",
      "requestId",
      "requestedAt",
    ]);
    const published = mocks.createSystemUpdateRequest.mock.calls[0][0];
    expect(published).toEqual({
      protocolVersion: 1,
      requestId: REQUEST_ID,
      requestedAt: expect.any(String),
      requestedBy: ADMIN_ID,
    });
    expect(Object.keys(published).sort()).toEqual([
      "protocolVersion",
      "requestId",
      "requestedAt",
      "requestedBy",
    ]);
    expect(mocks.writeAuditHttp).toHaveBeenCalledWith({
      adminId: ADMIN_ID,
      action: "system_update_start",
      targetType: "system_update",
      targetId: REQUEST_ID,
      after: {
        requestId: REQUEST_ID,
        currentVersion: "0.2.0",
        targetVersion: "0.3.0",
      },
      ip: "203.0.113.9",
    });
    expect(mocks.assertSystemUpdateReservationOwned).toHaveBeenCalledOnce();
    expect(mocks.assertSystemUpdateReservationOwned.mock.calls[0][0]).toMatchObject({
      requestId: REQUEST_ID,
    });
    expect(mocks.assertSystemUpdateReservationOwned.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSystemUpdateRequest.mock.invocationCallOrder[0],
    );
    expect(mocks.handoffSystemUpdateReservation).toHaveBeenCalledOnce();
    expect(mocks.releaseSystemUpdateReservation).not.toHaveBeenCalled();
  });

  it("waits for audit completion before publishing", async () => {
    let finishAudit!: () => void;
    mocks.writeAuditHttp.mockImplementation(
      () => new Promise<void>((resolve) => { finishAudit = resolve; }),
    );

    const pending = action({ request: startRequest() } as never);
    await vi.waitFor(() => expect(mocks.writeAuditHttp).toHaveBeenCalledOnce());
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();

    finishAudit();
    expect((await pending).status).toBe(202);
    expect(mocks.createSystemUpdateRequest).toHaveBeenCalledOnce();
  });

  it("does not publish when audit fails", async () => {
    mocks.writeAuditHttp.mockRejectedValue(new Error("database unavailable"));

    await expectError(await action({ request: startRequest() } as never), 500, "INTERNAL");
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("rejects a lost reservation immediately before publication", async () => {
    mocks.assertSystemUpdateReservationOwned.mockRejectedValue(
      new UpdateStartReservationLostError(),
    );

    await expectError(await action({ request: startRequest() } as never), 409, "UPDATE_CONFLICT");
    expect(mocks.writeAuditHttp).toHaveBeenCalledOnce();
    expect(mocks.createSystemUpdateRequest).not.toHaveBeenCalled();
    expect(mocks.handoffSystemUpdateReservation).not.toHaveBeenCalled();
    expect(mocks.releaseSystemUpdateReservation).toHaveBeenCalledOnce();
  });

  it("maps a duplicate request publication to conflict", async () => {
    mocks.createSystemUpdateRequest.mockRejectedValue(new UpdateRequestConflictError());

    await expectError(await action({ request: startRequest() } as never), 409, "UPDATE_CONFLICT");
  });

  it("returns 202 for matching publication uncertainty without retrying", async () => {
    mocks.createSystemUpdateRequest.mockImplementation(async (requestValue) => {
      throw new UpdateRequestPublicationUncertainError(requestValue.requestId);
    });
    mocks.handoffSystemUpdateReservation.mockRejectedValue(new Error("lease close failed"));

    const response = await action({ request: startRequest() } as never);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ requestId: REQUEST_ID, targetVersion: "0.3.0" });
    expect(mocks.createSystemUpdateRequest).toHaveBeenCalledOnce();
    expect(mocks.handoffSystemUpdateReservation).toHaveBeenCalledOnce();
    expect(mocks.releaseSystemUpdateReservation).not.toHaveBeenCalled();
  });

  it("fails closed for mismatched publication uncertainty and generic filesystem errors", async () => {
    mocks.createSystemUpdateRequest.mockRejectedValueOnce(
      new UpdateRequestPublicationUncertainError("00000000-0000-4000-8000-000000000099"),
    );
    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");

    mocks.createSystemUpdateRequest.mockRejectedValueOnce(new Error("filesystem path leaked"));
    await expectError(await action({ request: startRequest() } as never), 503, "UPDATE_UNAVAILABLE");
  });

  it("passes through a Response thrown during request publication", async () => {
    const response = Response.json({ error: { code: "MAINTENANCE", message: "busy" } }, { status: 503 });
    mocks.createSystemUpdateRequest.mockRejectedValue(response);

    expect(await action({ request: startRequest() } as never)).toBe(response);
  });
});
