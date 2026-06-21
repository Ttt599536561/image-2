// ★server-only：单日预算熔断（铁律①，真相源 04 §5.6 / 10 §11.8）。软硬分离：
//  - 软闸 isDailyBudgetExhausted(c)：入队前·三闸事务内用同一 client c 读当日 key（可偏旧、只快速预拦、省 compute）。
//  - 硬上限 incCallIfUnderCap()：后台调中转「前」走 HTTP，与「calls+1」同一条原子 UPDATE…WHERE calls<阈值 RETURNING
//    （防 TOCTOU 击穿、防破产唯一硬防线）。affected=0 ⇒ 越界、不调中转、置 failed/insufficient_quota。
//  - incMs(ms)：调中转「后」finally HTTP 累加，仅监控/告警、不硬挡（被平台杀少计 → 10 §11.8 cron 用 generations.duration_ms 之和重算覆盖）。
//
// 计数行 key=`relay_budget:${今日}`（今日按 Asia/Shanghai；跨天即新 key 从 0 起，天然归零，无须清零）。
// value_json = { calls:int, ms:int }。阈值取 app_config(daily_relay_budget_calls/ms，seed 落) → 缺省回退 env。
//
// 🔴 红线：硬上限必须是「带阈值条件同一原子 UPDATE…RETURNING」（绝不先读后写）；金额/计数全程整数。
import { getSql } from "../db/db.server";
import { getConfigInt, readConfigInt } from "./config.server";
import type { TxClient } from "./tx.server";

const CALLS_FALLBACK = 2000;
const MS_FALLBACK = 2000 * 300_000;

/** Asia/Shanghai 当日 YYYY-MM-DD（date-in-key 天然跨天归零）。运行时 Node 有 Date/Intl，非 Workflow 脚本受限环境。 */
function shanghaiDate(): string {
  // en-CA 区域给出 `YYYY-MM-DD` 形态。
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function budgetTodayKey(): string {
  return `relay_budget:${shanghaiDate()}`;
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 软闸（入队·事务内·同一 client c）：当日 calls 或 ms 触阈即视为熔断。
 * 读不到当日 key → 视为 0（跨天自动作废）。阈值缺省回退 env（DAILY_RELAY_BUDGET_CALLS/MS）。
 */
export async function isDailyBudgetExhausted(c: TxClient): Promise<boolean> {
  const callsCap = await readConfigInt(c, "daily_relay_budget_calls", envInt("DAILY_RELAY_BUDGET_CALLS", CALLS_FALLBACK));
  const msCap = await readConfigInt(c, "daily_relay_budget_ms", envInt("DAILY_RELAY_BUDGET_MS", MS_FALLBACK));
  const r = await c.query("SELECT value_json FROM app_config WHERE key=$1", [budgetTodayKey()]);
  if (r.rowCount === 0) return false;
  const v = (r.rows[0].value_json ?? {}) as { calls?: number; ms?: number };
  const calls = Number(v.calls ?? 0);
  const ms = Number(v.ms ?? 0);
  return calls >= callsCap || ms >= msCap;
}

/**
 * 硬上限（调中转前·防破产）：先保证今日 key 行存在，再「带阈值条件原子自增」。
 * 返回 true ⇒ 已占额、可调中转；false ⇒ 越界（affected=0）、拒调中转。
 * 阈值取 app_config(daily_relay_budget_calls) → 缺省回退 env。
 */
export async function incCallIfUnderCap(): Promise<boolean> {
  const sql = getSql();
  const callsCap = await getConfigInt("daily_relay_budget_calls", envInt("DAILY_RELAY_BUDGET_CALLS", CALLS_FALLBACK));
  const key = budgetTodayKey();
  await sql`INSERT INTO app_config(key, value_json) VALUES (${key}, '{"calls":0,"ms":0}'::jsonb) ON CONFLICT (key) DO NOTHING`;
  // 带阈值条件的原子自增：判 + 增同一条语句，杜绝 TOCTOU。
  const rows = await sql`
    UPDATE app_config
    SET value_json = jsonb_set(value_json, '{calls}', to_jsonb((value_json->>'calls')::bigint + 1)), updated_at = now()
    WHERE key = ${key} AND (value_json->>'calls')::bigint < ${callsCap}
    RETURNING value_json`;
  return rows.length > 0;
}

/** ms 累计（调中转后·仅监控/告警·不硬挡）。被平台杀少计由 10 §11.8 cron 用 generations.duration_ms 之和重算覆盖。 */
export async function incMs(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const sql = getSql();
  const key = budgetTodayKey();
  await sql`INSERT INTO app_config(key, value_json) VALUES (${key}, '{"calls":0,"ms":0}'::jsonb) ON CONFLICT (key) DO NOTHING`;
  await sql`
    UPDATE app_config
    SET value_json = jsonb_set(value_json, '{ms}', to_jsonb((value_json->>'ms')::bigint + ${ms})), updated_at = now()
    WHERE key = ${key}`;
}
