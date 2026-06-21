// ★server-only：全局参数管理（09 §10.6）。读全部 app_config + 校验后写（即时生效，业务运行时读 app_config）。
// 🔴 每键最小值约束（§24-13）；改配置同事务写审计。
import { type ConfigKey, CONFIG_KEYS } from "../../contracts/admin";
import { getSql } from "../../db/db.server";
import { type TxClient, tx } from "../tx.server";
import { writeAudit } from "./audit.server";

type Row = Record<string, unknown>;

// 每键默认 + 最小值（§24-13；signup_grant_mp 可为 0，其余 ≥1 或 >0）。
const CONFIG_META: Record<ConfigKey, { def: number; min: number }> = {
  price_per_image_mp: { def: 70, min: 1 },
  signup_grant_mp: { def: 140, min: 0 },
  signup_grant_valid_days: { def: 30, min: 1 },
  retention_free_days: { def: 7, min: 1 },
  retention_paid_days: { def: 60, min: 1 },
  default_max_concurrency: { def: 2, min: 1 },
  daily_relay_budget_calls: { def: 2000, min: 1 },
  daily_relay_budget_ms: { def: 2000 * 300_000, min: 1 },
};

/** 读全部可改参数（缺省回退默认值）。 */
export async function getAllConfig(): Promise<{ items: { key: ConfigKey; value: number }[] }> {
  const sql = getSql();
  const rows = (await sql`SELECT key, value_json FROM app_config WHERE key = ANY(${[...CONFIG_KEYS]})`) as Row[];
  const map = new Map(rows.map((r) => [r.key as string, Number(r.value_json)]));
  return {
    items: CONFIG_KEYS.map((key) => ({
      key,
      value: map.has(key) && Number.isFinite(map.get(key)) ? (map.get(key) as number) : CONFIG_META[key].def,
    })),
  };
}

/** 校验 + 写（每键 ON CONFLICT 更新 + 同事务审计）。返回写入数；任一键违约即整体抛 400。 */
export async function updateConfig(args: {
  adminId: string;
  updates: { key: ConfigKey; value: number }[];
  ip?: string | null;
}): Promise<{ updated: number }> {
  // 校验（任一违约即抛，不部分写）。
  for (const u of args.updates) {
    const meta = CONFIG_META[u.key];
    if (!meta) throw new Response(`未知参数 ${u.key}`, { status: 400 });
    if (!Number.isInteger(u.value) || u.value < meta.min) {
      throw new Response(`参数 ${u.key} 须为整数且 ≥ ${meta.min}`, { status: 400 });
    }
  }
  return tx(async (c: TxClient) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, number> = {};
    for (const u of args.updates) {
      const prev = (await c.query("SELECT value_json FROM app_config WHERE key=$1", [u.key])).rows[0];
      before[u.key] = prev ? Number(prev.value_json) : null;
      await c.query(
        `INSERT INTO app_config(key,value_json,updated_at) VALUES($1,$2::jsonb,now())
         ON CONFLICT (key) DO UPDATE SET value_json=$2::jsonb, updated_at=now()`,
        [u.key, JSON.stringify(u.value)],
      );
      after[u.key] = u.value;
    }
    await writeAudit(c, { adminId: args.adminId, action: "edit_config", targetType: "config", before, after, ip: args.ip ?? null });
    return { updated: args.updates.length };
  });
}
