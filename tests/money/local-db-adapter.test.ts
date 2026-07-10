import { describe, expect, it } from "vitest";
import { getPool, getSql } from "../../src/db/db.server";

describe("disposable local database adapter", () => {
  it("supports tagged reads and transactional queries", async () => {
    const sql = getSql();
    const rows = await sql`SELECT ${41}::int + 1 AS answer`;
    expect(Number(rows[0]?.answer)).toBe(42);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT $1::int AS answer", [42]);
      expect(Number(result.rows[0]?.answer)).toBe(42);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });
});
