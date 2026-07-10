import { readFileSync } from "node:fs";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

const { getPool } = await import("../src/db/db.server");
const ddl = readFileSync(new URL("../drizzle/0005_user_generation_credentials.sql", import.meta.url), "utf8");
const pool = getPool();
const client = await pool.connect();

try {
  await client.query(ddl);
  const result = await client.query(
    `SELECT
       (SELECT count(*) FROM information_schema.columns
        WHERE table_name='generations' AND column_name IN ('credential_mode','deadline_at')) AS generation_columns,
       (SELECT count(*) FROM information_schema.tables
        WHERE table_name='generation_credentials') AS credential_tables`,
  );
  console.log(
    `[migrate] 0005 applied. generation columns=${result.rows[0].generation_columns}/2 credential table=${result.rows[0].credential_tables}/1`,
  );
} finally {
  client.release();
  await pool.end();
}
