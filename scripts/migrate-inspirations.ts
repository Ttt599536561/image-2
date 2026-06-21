// 应用 0001 灵感库迁移（幂等 CREATE TABLE IF NOT EXISTS）。
// 跑：node --env-file=.env --import tsx scripts/migrate-inspirations.ts
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/db.server";

const ddl = readFileSync(new URL("../drizzle/0001_inspirations.sql", import.meta.url), "utf8");
const pool = getPool();
const c = await pool.connect();
try {
  await c.query(ddl);
  const r = await c.query(
    "SELECT to_regclass('public.inspirations') AS t, (SELECT count(*) FROM pg_indexes WHERE indexname='ix_insp_active_sort') AS idx",
  );
  console.log(`[migrate] 0001_inspirations applied. table=${r.rows[0].t} index=${r.rows[0].idx}`);
} finally {
  c.release();
  await pool.end();
}
process.exit(0);
