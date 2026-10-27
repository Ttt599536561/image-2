import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { describe, expect, it } from "vitest";
import { createAuthPool } from "./auth-pool";

describe("createAuthPool", () => {
  it("bounds authentication connections using explicit configuration", async () => {
    const pool = createAuthPool({ DATABASE_DRIVER: "pg", PG_AUTH_POOL_MAX: "6", PG_CONNECTION_TIMEOUT_MS: "2500" });
    expect(pool.options).toMatchObject({ max: 6, connectionTimeoutMillis: 2500 });
    await pool.end();
  });

  it.each(["0", "-1", "Infinity", "1.5", "65"])("rejects unsafe pool size %s", (value) => {
    expect(() => createAuthPool({ DATABASE_DRIVER: "pg", PG_AUTH_POOL_MAX: value })).toThrow("PG_AUTH_POOL_MAX");
  });

  it("uses a configured node-postgres pool for the production pg driver", async () => {
    const pool = createAuthPool({
      DATABASE_DRIVER: "pg",
      DATABASE_URL_UNPOOLED: "postgresql://postgres:secret@postgres:5432/workshop",
    });

    expect(pool).toBeInstanceOf(PgPool);
    expect(pool.options).toMatchObject({
      connectionString: "postgresql://postgres:secret@postgres:5432/workshop",
      allowExitOnIdle: true,
      max: 4,
    });
    await pool.end();
  });

  it("retains node-postgres for the disposable test driver", async () => {
    const pool = createAuthPool({
      DISPOSABLE_TEST_DB_DRIVER: "pg",
      DATABASE_URL_UNPOOLED: "postgresql://localhost/disposable",
    });
    expect(pool).toBeInstanceOf(PgPool);
    await pool.end();
  });

  it("keeps the Neon pool in normal environments", async () => {
    const pool = createAuthPool({
      DATABASE_URL_UNPOOLED: "postgresql://localhost/production-placeholder",
    });
    expect(pool).toBeInstanceOf(NeonPool);
    await pool.end();
  });
});
