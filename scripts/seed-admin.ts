// 写死管理员账号：注册（若不存在）+ 提权（双写 users.role + Better Auth "user".role）。幂等、可重跑。
// 凭据从 env 读，**绝不硬编码进源码**（密码进 git 历史 = 泄露）：在 .env（已 gitignore）设
//   SEED_ADMIN_EMAIL=<邮箱>
//   SEED_ADMIN_PASSWORD=<密码，≥6 位 / ≤72 字节>
// 跑：node --env-file=.env --import tsx scripts/seed-admin.ts
//   （新库流程：先迁移 + seed，再跑本脚本建管理员。）
import { getSql } from "../src/db/db.server";
import { auth } from "../src/lib/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("需在 .env 设 SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD（密码 ≥6 位）后重跑。");
    process.exit(1);
  }
  const sql = getSql();

  // 1) 业务 users 无此邮箱 → 经 Better Auth 注册建号（含 140mp 发放钩子；password.hash 内 72 字节断言）。
  const exists = (await sql`SELECT id FROM users WHERE email=${email}`) as { id: string }[];
  if (exists.length === 0) {
    await auth.api.signUpEmail({ body: { email, password, name: email } });
    console.log(`✓ 已注册 ${email}（送 140mp）`);
  } else {
    console.log(`· ${email} 已存在，跳过注册（如需改密走 /admin 用户管理或后台改密）`);
  }

  // 2) 提权双写：业务 users.role（/admin 守卫权威）+ Better Auth "user".role（admin 插件 ban/改密用）。
  const biz = (await sql`UPDATE users SET role='admin', updated_at=now() WHERE email=${email} RETURNING id`) as {
    id: string;
  }[];
  if (biz.length === 0) {
    console.error(`✗ ${email} 未在业务 users 表（注册可能失败）。`);
    process.exit(1);
  }
  const hasRole = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='user' AND column_name='role'`;
  if (hasRole.length > 0) await sql`UPDATE "user" SET role='admin' WHERE email=${email}`;

  console.log(`✓ ${email} 已是管理员（users.role + Better Auth user.role）。`);
  console.log("  用配置的密码登录 /login → 进 /admin（requireUserStrict 每请求查 DB，即时生效）。");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-admin] 失败：", e);
  process.exit(1);
});
