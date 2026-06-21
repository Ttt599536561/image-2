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

/**
 * 「命中即告警·每天首次」去重闸（真相源 10 §11.9 daily_budget_exhausted「每天首次」）。
 * 在当日 key 的 value_json 上原子置 alerted=true：返回 true=本次首发（调用方应发告警）、false=今日已发过。
 * 由 process.ts 硬上限命中分支调用（此刻当日 key 必已由 incCallIfUnderCap 建好；不存在则 RETURNING 0、不告警、不抛）。
 */
export async function markBudgetAlertedOnce(): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE app_config
    SET value_json = jsonb_set(value_json, '{alerted}', 'true'::jsonb), updated_at = now()
    WHERE key = ${budgetTodayKey()} AND COALESCE((value_json->>'alerted')::boolean, false) = false
    RETURNING key`;
  return rows.length > 0;
}

export interface BudgetCleanupResult {
  evaluatedDate: string; // 被评估的「已结束的前一天」Shanghai 日期（YYYY-MM-DD）
  deletedKeys: number; // 删除的旧日期键数（保留近 7 天）
  calls: number; // 昨日 calls 计数（0 = 昨日无 key/无流量）
  recomputedMs: number; // 昨日 ms（用 generations.duration_ms 之和重算覆盖后的权威值）
  callsCap: number;
  msCap: number;
  budgetExhausted: boolean; // 昨日 calls 或重算 ms 达上限（回溯告警；实时熔断告警在 process.ts）
  nearThreshold: boolean; // ≥80% 近阈
}

/**
 * 旧预算键清理 + 「已结束的前一天」ms 重算覆盖 + 回溯近阈/熔断判定（cron · 真相源 10 §11.8）。HTTP 单语句。
 *  - 跨天靠 date-in-key 自动归零，无需清零当日键；本 cron 只删旧键（保留近 7 天供看板回溯）。
 *  - **评估「昨天」而非「今天」**：cron 跑在北京 00:00，当天 0 点刚开始 calls/ms≈0（评估今天恒为 0、告警死代码，
 *    对抗审查 alerting-major）；回看刚结束的昨天才有完整流量、近阈/熔断告警才有意义。
 *  - 昨日 ms 用 generations.duration_ms 之和重算覆盖（平台杀进程会丢 finally 的 incMs，以落库时长为权威）；
 *    只覆盖 ms 路径、保留 calls（calls 是调中转前抢占式 +1 的硬上限计数，不可被重算冲掉）。昨日无 key（无流量）则不创建、不告警。
 *  - **实时「命中即告警」在 process.ts**（硬上限命中分支 markBudgetAlertedOnce + alert）；本 cron 只补回溯日报。
 */
export async function cleanupBudgetKeys(): Promise<BudgetCleanupResult> {
  const sql = getSql();
  const callsCap = await getConfigInt("daily_relay_budget_calls", envInt("DAILY_RELAY_BUDGET_CALLS", CALLS_FALLBACK));
  const msCap = await getConfigInt("daily_relay_budget_ms", envInt("DAILY_RELAY_BUDGET_MS", MS_FALLBACK));

  // 被评估的「昨天」Shanghai 日期 + 其 key。
  const [{ d: evaluatedDate }] = (await sql`
    SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day', 'YYYY-MM-DD') AS d`) as Array<{ d: string }>;
  const yKey = `relay_budget:${evaluatedDate}`;

  // ① 删 7 天前及更早的旧预算键（保留近 7 天，含昨天）。
  const del = await sql`
    DELETE FROM app_config
    WHERE key LIKE 'relay_budget:%'
      AND substring(key from 'relay_budget:(.*)') < to_char((now() AT TIME ZONE 'Asia/Shanghai') - interval '7 days', 'YYYY-MM-DD')
    RETURNING key`;

  // ② 昨日 ms 用 generations.duration_ms 之和重算覆盖（昨日 Shanghai 窗口；BIGINT 求和防溢出；只动 ms、保留 calls）。
  //    不 INSERT：昨日无 key（无流量）则 UPDATE 命中 0、calls/ms=0、不告警（不污染空键）。
  const recomputed = await sql`
    WITH yday_ms AS (
      SELECT COALESCE(SUM(duration_ms), 0)::bigint AS ms
      FROM generations
      WHERE started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day') AT TIME ZONE 'Asia/Shanghai'
        AND started_at <  date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
    )
    UPDATE app_config
    SET value_json = jsonb_set(value_json, '{ms}', to_jsonb((SELECT ms FROM yday_ms))), updated_at = now()
    WHERE key = ${yKey}
    RETURNING (value_json->>'calls')::bigint AS calls, (value_json->>'ms')::bigint AS ms`;
  const calls = Number(recomputed[0]?.calls ?? 0);
  const recomputedMs = Number(recomputed[0]?.ms ?? 0);

  const budgetExhausted = calls >= callsCap || recomputedMs >= msCap;
  const nearThreshold = calls >= callsCap * 0.8 || recomputedMs >= msCap * 0.8;
  return { evaluatedDate, deletedKeys: del.length, calls, recomputedMs, callsCap, msCap, budgetExhausted, nearThreshold };
}
