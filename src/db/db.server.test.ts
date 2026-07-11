// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const neonPoolEnd = vi.fn(async () => {});
const neonPoolConnect = vi.fn();

vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(),
  neonConfig: {},
  Pool: class {
    connect = neonPoolConnect;
    end = neonPoolEnd;
  },
}));

vi.mock("ws", () => ({ default: class WebSocket {} }));

describe("database pool lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    neonPoolConnect.mockReset();
    neonPoolEnd.mockClear();
    delete process.env.DISPOSABLE_TEST_DB_DRIVER;
    process.env.DATABASE_URL = "postgres://read";
    process.env.DATABASE_URL_UNPOOLED = "postgres://transaction";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses one transaction pool and closes it during graceful shutdown", async () => {
    const { closeDbPools, getPool } = await import("./db.server");

    expect(getPool()).toBe(getPool());

    await closeDbPools();
    expect(neonPoolEnd).toHaveBeenCalledTimes(1);
  });
});
