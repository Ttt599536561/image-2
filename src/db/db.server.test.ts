// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockPoolInstance {
  options: Record<string, unknown>;
  connect: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  query?: ReturnType<typeof vi.fn>;
}

const dbMocks = vi.hoisted(() => ({
  neon: vi.fn(),
  neonPools: [] as MockPoolInstance[],
  pgPools: [] as MockPoolInstance[],
  pgRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: dbMocks.neon,
  neonConfig: {},
  Pool: class {
    connect = vi.fn();
    end = vi.fn(async () => {});

    constructor(options: Record<string, unknown>) {
      dbMocks.neonPools.push({ options, connect: this.connect, end: this.end });
    }
  },
}));

vi.mock("pg", () => ({
  Pool: class {
    connect = vi.fn();
    end = vi.fn(async () => {});
    query = vi.fn(async () => ({ rows: dbMocks.pgRows, rowCount: dbMocks.pgRows.length }));

    constructor(options: Record<string, unknown>) {
      dbMocks.pgPools.push({
        options,
        connect: this.connect,
        end: this.end,
        query: this.query,
      });
    }
  },
}));

vi.mock("ws", () => ({ default: class WebSocket {} }));

function pgPoolFor(connectionString: string): MockPoolInstance {
  const pool = dbMocks.pgPools.find((candidate) => candidate.options.connectionString === connectionString);
  if (!pool) throw new Error(`Missing pg pool for ${connectionString}`);
  return pool;
}

describe("database driver selection", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.neon.mockReset();
    dbMocks.neonPools.length = 0;
    dbMocks.pgPools.length = 0;
    dbMocks.pgRows = [];
    delete process.env.DATABASE_DRIVER;
    delete process.env.DISPOSABLE_TEST_DB_DRIVER;
    process.env.DATABASE_URL = "postgres://read";
    process.env.DATABASE_URL_UNPOOLED = "postgres://transaction";
  });

  it("selects standard PostgreSQL when DATABASE_DRIVER is pg", async () => {
    const { usesPgDriver } = await import("./db.server");

    expect(usesPgDriver({ DATABASE_DRIVER: "pg" })).toBe(true);
    expect(usesPgDriver({ DATABASE_DRIVER: "neon" })).toBe(false);
  });

  it("preserves the disposable PostgreSQL test driver", async () => {
    const { usesPgDriver } = await import("./db.server");

    expect(usesPgDriver({ DISPOSABLE_TEST_DB_DRIVER: "pg" })).toBe(true);
  });

  it("reuses a PostgreSQL transaction pool with the unpooled URL", async () => {
    process.env.DATABASE_DRIVER = "pg";
    const { closeDbPools, getPool } = await import("./db.server");

    expect(getPool()).toBe(getPool());
    expect(dbMocks.neonPools).toHaveLength(0);
    expect(dbMocks.pgPools).toHaveLength(1);
    expect(dbMocks.pgPools[0]?.options).toEqual({
      connectionString: "postgres://transaction",
      allowExitOnIdle: true,
      max: 4,
    });

    await closeDbPools();
  });

  it("reuses a PostgreSQL read pool and parameterizes template values", async () => {
    process.env.DATABASE_DRIVER = "pg";
    dbMocks.pgRows = [{ id: "image-1" }];
    const { closeDbPools, getSql } = await import("./db.server");

    const firstSql = getSql();
    const secondSql = getSql();
    const rows = await firstSql`SELECT id FROM images WHERE owner_id = ${"user-1"} AND status = ${"ready"}`;
    await secondSql`SELECT 1`;

    expect(dbMocks.pgPools).toHaveLength(1);
    const readPool = pgPoolFor("postgres://read");
    expect(readPool.options).toEqual({
      connectionString: "postgres://read",
      allowExitOnIdle: true,
      max: 4,
    });
    expect(readPool.query).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM images WHERE owner_id = $1 AND status = $2",
      ["user-1", "ready"],
    );
    expect(readPool.query).toHaveBeenNthCalledWith(2, "SELECT 1", []);
    expect(rows).toEqual([{ id: "image-1" }]);

    await closeDbPools();
  });

  it("closes and clears both PostgreSQL pools", async () => {
    process.env.DATABASE_DRIVER = "pg";
    const { closeDbPools, getPool, getSql } = await import("./db.server");

    const transactionPool = getPool();
    await getSql()`SELECT 1`;
    const transactionMock = pgPoolFor("postgres://transaction");
    const readMock = pgPoolFor("postgres://read");

    await closeDbPools();

    expect(transactionMock.end).toHaveBeenCalledTimes(1);
    expect(readMock.end).toHaveBeenCalledTimes(1);
    expect(getPool()).not.toBe(transactionPool);

    await closeDbPools();
  });

  it("uses cached PostgreSQL pools for the disposable test driver", async () => {
    process.env.DISPOSABLE_TEST_DB_DRIVER = "pg";
    const { closeDbPools, getPool, getSql } = await import("./db.server");

    expect(getPool()).toBe(getPool());
    await getSql()`SELECT 1`;
    expect(dbMocks.pgPools).toHaveLength(2);
    expect(dbMocks.neonPools).toHaveLength(0);

    await closeDbPools();
  });

  it("keeps Neon as the default driver", async () => {
    const neonSql = vi.fn();
    dbMocks.neon.mockReturnValue(neonSql);
    const { closeDbPools, getPool, getSql } = await import("./db.server");

    expect(getPool()).toBe(getPool());
    expect(getSql()).toBe(neonSql);
    expect(dbMocks.neon).toHaveBeenCalledWith("postgres://read");
    expect(dbMocks.pgPools).toHaveLength(0);

    await closeDbPools();
    expect(dbMocks.neonPools[0]?.end).toHaveBeenCalledTimes(1);
  });
});
