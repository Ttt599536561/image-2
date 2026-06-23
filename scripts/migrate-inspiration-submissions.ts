// 应用 0004 灵感投稿迁移（幂等：新表 inspiration_submissions + inspirations 署名两列；§13.1）。
// 跑：node --env-file=.env --import tsx scripts/migrate-inspiration-submissions.ts
import { readFileSync } from "node:fs";
import { getPool } from "../src/db/db.server";

const ddl = readFileSync(new URL("../drizzle/0004_inspiration_submissions.sql", import.meta.url), "utf8");
const pool = getPool();
const c = await pool.connect();
try {
  await c.query(ddl);
  const t = await c.query(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name='inspiration_submissions'`,
  );
  const cols = await c.query(
    `SELECT count(*) AS n FROM information_schema.columns
     WHERE table_name='inspirations' AND column_name IN ('submitted_by','submitter_name')`,
  );
  console.log(
    `[migrate] 0004_inspiration_submissions applied. 表存在=${t.rows[0].n} · inspirations 署名列=${cols.rows[0].n}/2`,
  );
} finally {
  c.release();
  await pool.end();
}
process.exit(0);
