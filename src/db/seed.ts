// 种子数据（02 §3.5 / 10 §10.6 全局参数 / 04 §5.6 预算阈值）。
// 用 tsx 跑：`tsx src/db/seed.ts`（接真 Neon 后执行；需 DATABASE_URL）。
// 全部幂等：packages 用固定 UUID + ON CONFLICT DO NOTHING；app_config 用 key + ON CONFLICT DO NOTHING
// （不覆盖站长在后台改过的值）；admin 提权用 UPDATE WHERE email（设 SEED_ADMIN_EMAIL 才执行）。
//
// 注：admin 账号本身经「Better Auth 普通注册流程」建号（阶段二 §2），seed 只负责「把某邮箱翻成 role=admin」。
//     金额换算速查（02 §3.6）：1 积分 = 1000 mp；0.07/张 = 70mp；0.14 赠送 = 140mp；¥9.9 → price_cash=990。

import { getSql } from "./db.server";
import { DEFAULT_PURCHASE_URL } from "../lib/site";

// 两个默认套餐用固定 UUID，保证重复跑 seed 不产生重复行（02 §3.5）。
const PKG_9_9 = "00000000-0000-4000-a000-000000000001";
const PKG_29_9 = "00000000-0000-4000-a000-000000000002";

// 正数 env（缺省用 fallback；非数值/≤0 当场报错，绝不静默 seed 出 NaN→JSON null）。
function posNumEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[seed] 环境变量 ${name}=${raw} 非正数（铁律① 预算阈值须 >0，10 §10.6）`);
  }
  return n;
}

// app_config 默认（10 §10.6；value_json 存 JSON 标量；预算阈值 env 起始、可后台改）。
const CONFIG_DEFAULTS: Record<string, number> = {
  price_per_image_mp: 70, // 0.07 积分/张
  signup_grant_mp: 140, // 注册赠送 0.14（2 张）
  signup_grant_valid_days: 30, // 赠送批次有效期
  retention_free_days: 7, // 免费保留期
  retention_paid_days: 60, // 付费保留期
  default_max_concurrency: 2, // 默认并发
  // 预算熔断阈值（铁律①，04 §5.6）。env 起始；GB-hour 实测对账后（铁律②）调准。
  daily_relay_budget_calls: posNumEnv("DAILY_RELAY_BUDGET_CALLS", 2000),
  daily_relay_budget_ms: posNumEnv("DAILY_RELAY_BUDGET_MS", 2000 * 300_000),
};

export async function seed(): Promise<void> {
  const sql = getSql();

  // —— 默认套餐（¥9.9 → 10 积分；¥29.9 → 32 积分）——
  // valid_days 为占位默认（365 天），站长可在后台改（02 §3.5「由站长定」）。
  // redirect_url 默认统一跳第三方店铺（站长 2026-06-22 给；⑥ 后台可按套餐覆盖）。
  await sql`
    INSERT INTO packages (id, title, description, price_cash, credits_mp, valid_days, redirect_url, sort, active)
    VALUES (${PKG_9_9}, '入门包', '适合轻度尝鲜', 990, 10000, 365, ${DEFAULT_PURCHASE_URL}, 1, true)
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO packages (id, title, description, price_cash, credits_mp, valid_days, redirect_url, sort, active)
    VALUES (${PKG_29_9}, '标准包', '高频创作更划算', 2990, 32000, 365, ${DEFAULT_PURCHASE_URL}, 2, true)
    ON CONFLICT (id) DO NOTHING`;

  // —— 全局参数（app_config）——
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await sql`
      INSERT INTO app_config (key, value_json)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (key) DO NOTHING`;
  }

  // —— admin 提权（可选）——
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (adminEmail) {
    const r = await sql`UPDATE users SET role='admin', updated_at=now() WHERE email=${adminEmail} RETURNING id`;
    if (r.length === 0) {
      console.warn(`[seed] 邮箱 ${adminEmail} 尚未注册；先经 Better Auth 注册建号再重跑 seed 提权。`);
    } else {
      console.log(`[seed] 已将 ${adminEmail} 提权为 admin。`);
    }
  }

  console.log("[seed] 完成：packages(2) + app_config(默认) 已就绪（幂等）。");
}

// 直接以脚本运行时执行（ESM：import.meta.url 即入口）。
const isDirectRun =
  typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[seed] 失败：", e);
      process.exit(1);
    });
}
