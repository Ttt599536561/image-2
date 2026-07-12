// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBody } from "../../contracts/error";

const state = vi.hoisted(() => ({
  readSystemUpdateStatus: vi.fn(),
}));

vi.mock("./state.server", () => ({
  readSystemUpdateStatus: state.readSystemUpdateStatus,
}));

import { rejectHttpWriteDuringMaintenance } from "./maintenance-guard.server";

const inactiveStatus = {
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

function args(method: string): Parameters<typeof rejectHttpWriteDuringMaintenance>[0] {
  return {
    request: { method } as Request,
  } as Parameters<typeof rejectHttpWriteDuringMaintenance>[0];
}

async function expectMaintenanceResponse(response: Response | void): Promise<string> {
  expect(response).toBeInstanceOf(Response);
  const concrete = response as Response;
  expect(concrete.status).toBe(503);
  const body = ErrorBody.parse(await concrete.json());
  expect(body.error.code).toBe("MAINTENANCE");
  return body.error.message;
}

describe("maintenance write guard", () => {
  beforeEach(() => {
    state.readSystemUpdateStatus.mockReset();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])(
    "blocks %s while maintenance is active without calling next",
    async (method) => {
      const next = vi.fn(async () => new Response("action reached"));
      const isMaintenance = vi.fn(async () => true);

      const response = await rejectHttpWriteDuringMaintenance(args(method), next, isMaintenance);

      await expectMaintenanceResponse(response);
      expect(isMaintenance).toHaveBeenCalledOnce();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])(
    "passes %s immediately without reading updater state",
    async (method) => {
      const expected = new Response(null, { status: 204 });
      const next = vi.fn(async () => expected);
      const isMaintenance = vi.fn(async () => true);

      const response = await rejectHttpWriteDuringMaintenance(args(method), next, isMaintenance);

      expect(response).toBe(expected);
      expect(isMaintenance).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it("passes a write exactly once when maintenance is inactive", async () => {
    const expected = new Response("action reached");
    const next = vi.fn(async () => expected);

    const response = await rejectHttpWriteDuringMaintenance(args("POST"), next, async () => false);

    expect(response).toBe(expected);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([null, inactiveStatus])(
    "uses the default reader and passes when it returns %s",
    async (status) => {
      state.readSystemUpdateStatus.mockResolvedValue(status);
      const expected = new Response("action reached");
      const next = vi.fn(async () => expected);

      const response = await rejectHttpWriteDuringMaintenance(args("POST"), next);

      expect(response).toBe(expected);
      expect(state.readSystemUpdateStatus).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it("fails closed without leaking a state-reader error", async () => {
    const next = vi.fn(async () => new Response("action reached"));

    const response = await rejectHttpWriteDuringMaintenance(args("POST"), next, async () => {
      throw new Error("EACCES /run/private/status.json");
    });

    const message = await expectMaintenanceResponse(response);
    expect(message).toMatch(/维护状态.*无法|无法.*维护状态/);
    expect(message).not.toContain("EACCES");
    expect(message).not.toContain("status.json");
    expect(next).not.toHaveBeenCalled();
  });
});
