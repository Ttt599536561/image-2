// 应用 0003 generations.input_image_key 列（幂等 ADD COLUMN IF NOT EXISTS；④b 图生图）。
// 跑：node --env-file=.env --import tsx scripts/migrate-input-image-key.ts
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/db.server";

const ddl = readFileSync(new URL("../drizzle/0003_input_image_key.sql", import.meta.url), "utf8");
const pool = getPool();
const c = await pool.connect();
try {
  await c.query(ddl);
  const r = await c.query(
    `SELECT count(*) AS n FROM information_schema.columns
     WHERE table_name='generations' AND column_name='input_image_key'`,
  );
  console.log(`[migrate] 0003_input_image_key applied. input_image_key 列存在=${r.rows[0].n}`);
} finally {
  c.release();
  await pool.end();
}
process.exit(0);
