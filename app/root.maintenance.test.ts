// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  readSystemUpdateStatus: vi.fn(),
}));

vi.mock("../src/server/system-update/state.server", () => ({
  readSystemUpdateStatus: state.readSystemUpdateStatus,
}));

import { middleware } from "./root";

const maintenanceStatus = {
  protocolVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  currentVersion: "0.2.0",
  targetVersion: "0.3.0",
  phase: "building",
  maintenance: true,
  startedAt: "2026-07-12T10:00:00.000Z",
  finishedAt: null,
  updatedAt: "2026-07-12T10:01:00.000Z",
  errorCode: null,
  errorMessage: null,
  backupId: null,
  recoveryCommand: null,
};

function args(method: string): Parameters<(typeof middleware)[number]>[0] {
  return {
    request: new Request("https://example.invalid/api/resource", { method }),
    params: {},
    context: {},
  } as Parameters<(typeof middleware)[number]>[0];
}

describe("root maintenance middleware", () => {
  it("registers one root middleware and blocks a resource-route POST before its action", async () => {
    state.readSystemUpdateStatus.mockResolvedValue(maintenanceStatus);
    const action = vi.fn(async () => new Response("action reached"));

    expect(middleware).toHaveLength(1);
    const response = await middleware[0]!(args("POST"), action);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect(await (response as Response).json()).toMatchObject({
      error: { code: "MAINTENANCE" },
    });
    expect(action).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "OPTIONS"])("lets root %s requests reach the route", async (method) => {
    state.readSystemUpdateStatus.mockClear();
    const expected = new Response(null, { status: 204 });
    const route = vi.fn(async () => expected);

    const response = await middleware[0]!(args(method), route);

    expect(response).toBe(expected);
    expect(route).toHaveBeenCalledOnce();
    expect(state.readSystemUpdateStatus).not.toHaveBeenCalled();
  });
});
