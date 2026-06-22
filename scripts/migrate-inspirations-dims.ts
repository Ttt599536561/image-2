// 应用 0002 灵感库封面宽高列（幂等 ADD COLUMN IF NOT EXISTS；P3-S4）。
// 跑：node --env-file=.env --import tsx scripts/migrate-inspirations-dims.ts
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/db.server";

const ddl = readFileSync(new URL("../drizzle/0002_inspirations_dims.sql", import.meta.url), "utf8");
const pool = getPool();
const c = await pool.connect();
try {
  await c.query(ddl);
  const r = await c.query(
    `SELECT count(*) FILTER (WHERE column_name='width')  AS w,
            count(*) FILTER (WHERE column_name='height') AS h
     FROM information_schema.columns WHERE table_name='inspirations'`,
  );
  console.log(`[migrate] 0002_inspirations_dims applied. width=${r.rows[0].w} height=${r.rows[0].h}`);
} finally {
  c.release();
  await pool.end();
}
process.exit(0);
