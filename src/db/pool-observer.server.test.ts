// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { observePgPool } from "./pool-observer.server";
import type { Pool } from "pg";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const client = { query: vi.fn(async (..._args: unknown[]) => ({ rows: [{ ok: true }] })), release: vi.fn() };
  const pool = { totalCount: 1, idleCount: 0, waitingCount: 2, connect: vi.fn((callback?: Function) => {
    if (callback) { callback(null, client, client.release); return; }
    return Promise.resolve(client);
  }) };
  return { client, pool };
}

describe("optional PostgreSQL timing", () => {
  it("leaves the pool untouched when diagnostics are disabled", () => {
    const { pool } = fixture();
    const original = pool.connect;
    expect(observePgPool(pool as unknown as Pool, "read", {})).toBe(pool);
    expect(pool.connect).toBe(original);
  });

  it("observes acquisition and queries without exposing SQL, parameters or errors", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { pool, client } = fixture();
    const underlyingQuery = client.query;
    observePgPool(pool as unknown as Pool, "read", { DB_TIMING_ENABLED: "true" });
    const connected = await pool.connect();
    expect(connected).toBe(client);
    await connected!.query("SELECT secret FROM account", ["private-key"]);
    underlyingQuery.mockRejectedValueOnce(new Error("secret database host/password"));
    await expect(connected!.query("SELECT broken")).rejects.toThrow();
    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.parse(log.mock.calls[0][1])).toMatchObject({ role: "read", phase: "acquire", waiting: 2 });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-key|SELECT|password|account/);
  });

  it("preserves callback-style acquisition and release", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { pool, client } = fixture();
    observePgPool(pool as unknown as Pool, "auth", { DB_TIMING_ENABLED: "true" });
    const callback = vi.fn();
    pool.connect(callback);
    expect(callback).toHaveBeenCalledWith(null, client, client.release);
    const wrapped = client.query;
    pool.connect(callback);
    expect(client.query).toBe(wrapped);
  });

  it("never fails a successful query because timing output is unavailable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("log sink unavailable"); });
    const { pool } = fixture();
    observePgPool(pool as unknown as Pool, "transaction", { DB_TIMING_ENABLED: "true" });
    const connected = await pool.connect();
    await expect(connected!.query("SELECT 1")).resolves.toEqual({ rows: [{ ok: true }] });
  });
});
