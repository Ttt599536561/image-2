// ② 鉴权接真冒烟：better-auth 表/uuid 列 + 注册原子发放 140mp + 幂等。
// 跑：node --import tsx scripts/test-env-guard.ts scripts/auth-smoke.ts
import { auth } from "../src/lib/auth";
import { getSql } from "../src/db/db.server";
import { grantSignup } from "../src/server/money/grant.server";

async function main() {
  const sql = getSql();

  // 1) better-auth 表 + user.id 列类型
  const bat = await sql`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY(${["user", "session", "account", "verification"]}) ORDER BY table_name`;
  const idType = await sql`SELECT data_type FROM information_schema.columns WHERE table_name='user' AND column_name='id'`;
  console.log(`better-auth tables: ${bat.length}/4 -> ${bat.map((t) => t.table_name).join(", ")}`);
  console.log(`user.id type: ${idType[0]?.data_type} (期望 uuid)`);

  // 2) 注册（触发 onUserRegistered → grantSignup）
  const email = `smoke+${Date.now()}@example.com`;
  const res = await auth.api.signUpEmail({ body: { email, password: "test123456", name: "smoke" } });
  const userId = (res as { user?: { id: string } }).user?.id;
  console.log(`\nsignUp: ${email} -> userId=${userId}`);
  if (!userId) throw new Error("signUp 未返回 userId");

  // 3) 验证原子发放（140mp）
  const acct = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${userId}`;
  const lots = await sql`SELECT source, granted_mp, remaining_mp, expires_at FROM credit_lots WHERE user_id=${userId}`;
  const grants = await sql`SELECT amount_mp, balance_after_mp, ref_type FROM credit_ledger WHERE user_id=${userId} AND entry_type='grant'`;
  const evs = await sql`SELECT type FROM events WHERE user_id=${userId} ORDER BY type`;
  const bizUser = await sql`SELECT email, role, has_paid FROM users WHERE id=${userId}`;
  console.log(`  business users: ${bizUser.length === 1 ? `ok (${bizUser[0].email}, role=${bizUser[0].role})` : "MISSING"}`);
  console.log(`  balance_mp: ${acct[0]?.balance_mp} (期望 140)`);
  console.log(`  lots: ${lots.length} (期望 1) -> ${lots.map((l) => `${l.source}:${l.remaining_mp}mp,exp=${l.expires_at ? "有" : "永久"}`).join(", ")}`);
  console.log(`  grant ledger: ${grants.length} (期望 1) amount=${grants[0]?.amount_mp} balance_after=${grants[0]?.balance_after_mp}`);
  console.log(`  events: ${evs.map((e) => e.type).join(", ")} (期望 credit_granted, user_registered)`);

  const pass1 = Number(acct[0]?.balance_mp) === 140 && lots.length === 1 && grants.length === 1 && bizUser.length === 1;

  // 4) 幂等：再调一次 grantSignup（模拟 hook 重放）→ 余额/批次不变
  await grantSignup(userId, email);
  const acct2 = await sql`SELECT balance_mp FROM credit_accounts WHERE user_id=${userId}`;
  const lots2 = await sql`SELECT id FROM credit_lots WHERE user_id=${userId}`;
  const grants2 = await sql`SELECT id FROM credit_ledger WHERE user_id=${userId} AND entry_type='grant'`;
  console.log(`\nidempotency re-grant: balance=${acct2[0]?.balance_mp} (期望 140) lots=${lots2.length} (期望 1) grants=${grants2.length} (期望 1)`);
  const pass2 = Number(acct2[0]?.balance_mp) === 140 && lots2.length === 1 && grants2.length === 1;

  // 5) 清理测试数据
  try {
    await sql`DELETE FROM events WHERE user_id=${userId}`;
    await sql`DELETE FROM users WHERE id=${userId}`; // 级联 credit_*
    await sql`DELETE FROM "user" WHERE id=${userId}`; // 级联 better-auth session/account
    console.log("\ncleanup: ok");
  } catch (e) {
    console.warn("\ncleanup 失败（非致命）:", (e as Error).message);
  }

  console.log(`\n[auth-smoke] ${pass1 && pass2 && idType[0]?.data_type === "uuid" ? "PASS" : "FAIL"}`);
  process.exit(pass1 && pass2 && idType[0]?.data_type === "uuid" ? 0 : 1);
}

main().catch((e) => {
  console.error("[auth-smoke] FAIL:", e);
  process.exit(1);
});
