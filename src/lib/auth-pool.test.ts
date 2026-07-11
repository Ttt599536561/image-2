import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { describe, expect, it } from "vitest";
import { createAuthPool } from "./auth-pool";

describe("createAuthPool", () => {
  it("uses node-postgres only for the disposable test driver", async () => {
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
