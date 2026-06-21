// 验证种子数据 + 幂等（配合二次跑 seed）。跑：node --env-file=.env --import tsx scripts/db-verify.ts
import { getSql } from "../src/db/db.server";

async function main() {
  const sql = getSql();
  const pkgs = await sql`SELECT title, price_cash, credits_mp, valid_days, active FROM packages ORDER BY sort`;
  console.log(`packages: ${pkgs.length}`);
  for (const p of pkgs) {
    console.log(`  ${p.title}: ¥${(Number(p.price_cash) / 100).toFixed(2)} / ${Number(p.credits_mp) / 1000} 积分 / ${p.valid_days ?? "永久"}天 / active=${p.active}`);
  }
  const cfg = await sql`SELECT key, value_json FROM app_config WHERE key NOT LIKE 'relay_budget:%' ORDER BY key`;
  console.log(`\napp_config: ${cfg.length}`);
  for (const c of cfg) console.log(`  ${c.key} = ${JSON.stringify(c.value_json)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[verify] FAIL:", e);
    process.exit(1);
  });
