// 写死管理员账号：注册（若不存在）+ 提权（双写 users.role + Better Auth "user".role）。幂等、可重跑。
// 凭据从 env 读，**绝不硬编码进源码**（密码进 git 历史 = 泄露）：在 .env（已 gitignore）设
//   SEED_ADMIN_EMAIL=<邮箱>
//   SEED_ADMIN_PASSWORD=<密码，≥6 位 / ≤72 字节>
// 跑：node --env-file=.env --import tsx scripts/seed-admin.ts
//   （新库流程：先迁移 + seed，再跑本脚本建管理员。）
import { seedAdminAccount } from "./seed-admin.server";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("需在 .env 设 SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD（密码 ≥6 位）后重跑。");
    process.exit(1);
  }
  const canonicalEmail = await seedAdminAccount(email, password);

  console.log(`✓ ${canonicalEmail} 已是管理员（users.role + Better Auth user.role）。`);
  console.log("  用配置的密码登录 /login → 进 /admin（requireUserStrict 每请求查 DB，即时生效）。");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed-admin] 失败：", e);
  process.exit(1);
});
