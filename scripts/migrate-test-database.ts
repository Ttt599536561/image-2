import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

const { getPool } = await import("../src/db/db.server");
const pool = getPool();
const client = await pool.connect();

try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS _test_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const directory = resolve(process.cwd(), "drizzle");
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const applied = await client.query("SELECT 1 FROM _test_migrations WHERE name=$1", [name]);
    if (applied.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(resolve(directory, name), "utf8"));
      await client.query("INSERT INTO _test_migrations(name) VALUES($1)", [name]);
      await client.query("COMMIT");
      console.log(`[migrate-test] applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
