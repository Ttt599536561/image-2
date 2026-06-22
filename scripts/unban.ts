// 应急解封（业务 users.is_banned + Better Auth user.banned/banExpires/banReason）。后台自锁时从这里恢复。
// 跑：node --env-file=.env --import tsx scripts/unban.ts <email>（缺省取 SEED_ADMIN_EMAIL）
import { getSql } from "../src/db/db.server";

async function main() {
  const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.error("用法：node --env-file=.env --import tsx scripts/unban.ts <email>（或 .env 设 SEED_ADMIN_EMAIL）");
    process.exit(1);
  }
  const sql = getSql();
  // 1) 业务权威：requireUserStrict 每请求查 is_banned，这是真正的锁。
  const biz = (await sql`UPDATE users SET is_banned=false, updated_at=now() WHERE email=${email} RETURNING id`) as {
    id: string;
  }[];
  if (biz.length === 0) {
    console.error(`✗ ${email} 不在业务 users 表`);
    process.exit(1);
  }
  // 2) Better Auth admin 插件列（若存在则清，避免其阻断登录）。
  const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name='user'`) as {
    column_name: string;
  }[];
  const names = new Set(cols.map((c) => c.column_name));
  if (names.has("banned")) await sql`UPDATE "user" SET banned=false WHERE email=${email}`;
  if (names.has("banExpires")) await sql`UPDATE "user" SET "banExpires"=NULL WHERE email=${email}`;
  if (names.has("banReason")) await sql`UPDATE "user" SET "banReason"=NULL WHERE email=${email}`;

  console.log(`✓ 已解封 ${email}（业务 is_banned=false + Better Auth banned 清除）。重新登录即可。`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[unban] 失败：", e);
  process.exit(1);
});
