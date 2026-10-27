// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clients: [] as any[], pg: true }));
vi.mock("../../db/db-driver.server", () => ({ usesPgDriver: () => mocks.pg }));
vi.mock("pg", () => ({
  Client: class extends EventEmitter {
    connect = vi.fn(async () => {});
    query = vi.fn(async () => {});
    end = vi.fn(async () => {});
    constructor() { super(); mocks.clients.push(this); }
  },
}));

const generationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const cleanups: Array<() => void> = [];
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("shared generation notifications", () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); mocks.clients.length = 0; mocks.pg = true;
    vi.stubEnv("DATABASE_URL_UNPOOLED", "postgres://local/test");
  });
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.useRealTimers(); vi.unstubAllEnvs();
  });

  it("connects lazily once, validates ID-only notifications and isolates subscriber failures", async () => {
    const { subscribeGenerationChanges } = await import("./notifications.server");
    expect(mocks.clients).toHaveLength(0);
    cleanups.push(subscribeGenerationChanges(() => { throw new Error("subscriber"); }));
    const listener = vi.fn();
    cleanups.push(subscribeGenerationChanges(listener));
    await flush();
    expect(mocks.clients).toHaveLength(1);
    const client = mocks.clients[0];
    expect(client.query).toHaveBeenCalledWith("LISTEN generation_changes");
    client.emit("notification", { channel: "generation_changes", payload: JSON.stringify({ generationId, userId, secret: "never-forward" }) });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ generationId, userId });
    client.emit("notification", { channel: "generation_changes", payload: "invalid" });
    client.emit("notification", { channel: "generation_changes", payload: JSON.stringify({ generationId: "invalid", userId }) });
    expect(listener).toHaveBeenCalledTimes(1);
    cleanups.shift()!();
    expect(client.end).not.toHaveBeenCalled();
    cleanups.shift()!();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("backs off reconnects and requests a recovery snapshot after LISTEN succeeds", async () => {
    const { subscribeGenerationChanges } = await import("./notifications.server");
    const recovered = vi.fn();
    cleanups.push(subscribeGenerationChanges(vi.fn(), recovered));
    await flush();
    expect(recovered).toHaveBeenCalledOnce();
    mocks.clients[0].emit("error", new Error("do not log credentials"));
    mocks.clients[0].emit("end");
    expect(mocks.clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.clients).toHaveLength(2);
    expect(recovered).toHaveBeenCalledTimes(2);
    mocks.clients[1].emit("end");
    cleanups.shift()!();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.clients).toHaveLength(2);
  });

  it("uses no listener connection on non-pg drivers", async () => {
    mocks.pg = false;
    const { subscribeGenerationChanges } = await import("./notifications.server");
    cleanups.push(subscribeGenerationChanges(vi.fn()));
    await flush();
    expect(mocks.clients).toHaveLength(0);
  });
});
