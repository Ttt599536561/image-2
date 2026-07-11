import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { describe, expect, it } from "vitest";
import { createAuthPool } from "./auth-pool";

describe("createAuthPool", () => {
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
