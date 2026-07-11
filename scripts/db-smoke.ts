// 接真冒烟（① 地基验证）：表/索引/gen_random_uuid/FOR UPDATE 交互式事务。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/db-smoke.ts
import { getPool, getSql } from "../src/db/db.server";

const BUSINESS_TABLES = [
  "users", "credit_accounts", "credit_lots", "credit_ledger", "packages", "redeem_codes",
  "conversations", "generations", "images", "audit_log", "notifications", "events", "app_config",
];
const CRIT_INDEXES = [
  "uq_debit", "uq_refund", "uq_grant_signup", "uq_credit_code", "uq_expire_lot",
  "uq_notif_dedupe", "ix_notif_user",
];

async function main() {
  const sql = getSql();

  const v = await sql`SELECT gen_random_uuid() AS uuid, version() AS pg`;
  console.log("PG:", String(v[0].pg).split(",")[0], "| gen_random_uuid:", v[0].uuid ? "ok" : "FAIL");

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY(${BUSINESS_TABLES})
    ORDER BY table_name`;
  console.log(`\ntables: ${tables.length}/13 -> ${tables.map((t) => t.table_name).join(", ")}`);

  const idx = await sql`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname = ANY(${CRIT_INDEXES})
    ORDER BY indexname`;
  console.log(`\ncritical indexes: ${idx.length}/7`);
  for (const r of idx) {
    const where = /WHERE (.+)$/.exec(r.indexdef)?.[1] ?? "(no WHERE)";
    console.log(`  ${r.indexname}: WHERE ${where}`);
  }

  // FOR UPDATE 交互式事务冒烟（Pool/WS over direct endpoint）。
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("SELECT 1 FROM credit_accounts WHERE user_id=gen_random_uuid() FOR UPDATE");
    await c.query("COMMIT");
    console.log(`\nFOR UPDATE interactive tx: ok (rows=${r.rowCount})`);
  } finally {
    c.release();
    await pool.end();
  }
  console.log("\n[smoke] PASS");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[smoke] FAIL:", e);
    process.exit(1);
  });
