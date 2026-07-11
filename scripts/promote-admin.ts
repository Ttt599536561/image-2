// 提权脚本：把某邮箱的账号翻成 admin（业务 users.role + Better Auth "user".role 双写）。
// 跑：node --env-file=.env --import tsx scripts/promote-admin.ts <email>
//   或先在 .env 设 SEED_ADMIN_EMAIL=<email> 再跑（不带参数）。
// 前提：该邮箱已经过 Better Auth 普通注册建号（阶段二 §2，/register 即可）。
//
// 为何双写（05 §6.2/§6.7）：
//  - 业务 users.role —— 我们的 requireAdmin/requireUserStrict 读它，是 /admin 路由 + /api/admin/* 守卫的权威。
//  - Better Auth "user".role —— admin 插件的 banUser/setUserPassword/revokeUserSessions 校验调用者角色时读它（⑥ 要用）。
import { getSql } from "../src/db/db.server";

async function main() {
  const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
  if (!email) {
    console.error("用法：node --env-file=.env --import tsx scripts/promote-admin.ts <email>（或在 .env 设 SEED_ADMIN_EMAIL）");
    process.exit(1);
  }
  const sql = getSql();

  // 1) 业务 users.role（/admin 守卫权威）。
  const biz = await sql`UPDATE users SET role='admin', updated_at=now() WHERE email=${email} RETURNING id`;
  if (biz.length === 0) {
    console.error(`✗ 邮箱 ${email} 未在业务 users 表找到——先经 Better Auth 注册建号（/register）再重跑。`);
    process.exit(1);
  }

  // 2) Better Auth "user".role（admin 插件操作校验，⑥ 用）。仅当该列存在时写。
  const hasRole = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='user' AND column_name='role'`;
  let baNote: string;
  if (hasRole.length > 0) {
    await sql`UPDATE "user" SET role='admin' WHERE email=${email}`;
    baNote = "Better Auth user.role=admin（admin 插件 ban/改密 可用）";
  } else {
    baNote = "⚠ Better Auth user 表无 role 列（admin 插件迁移未跑）——请先应用仓库受控迁移";
  }

  console.log(`✓ 已将 ${email} 提权为 admin（业务 users.role=admin；${baNote}）。`);
  console.log("  无需重新登录：requireUserStrict 每请求查 DB，下次请求即生效。");
  process.exit(0);
}

main().catch((e) => {
  console.error("[promote-admin] 失败：", e);
  process.exit(1);
});
