// ★server-only：全局参数读取（00 §1.5 / 10 §10.6，存 app_config，不写死）。
import { getSql } from "../db/db.server";
import type { TxClient } from "./tx.server";

/** 事务内读数值配置（同 client c、一致快照）。缺失/非数值 → fallback。 */
export async function readConfigInt(c: TxClient, key: string, fallback: number): Promise<number> {
  const r = await c.query("SELECT value_json FROM app_config WHERE key=$1", [key]);
  if (r.rowCount === 0) return fallback;
  const v = Number(r.rows[0].value_json);
  return Number.isFinite(v) ? v : fallback;
}

/** HTTP 读数值配置（无事务，看板/loader 用）。缺失/非数值 → fallback。 */
export async function getConfigInt(key: string, fallback: number): Promise<number> {
  const rows = await getSql()`SELECT value_json FROM app_config WHERE key=${key}`;
  if (rows.length === 0) return fallback;
  const v = Number(rows[0].value_json);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * HTTP 读字符串配置（中转 base_url/api_key 等，存为 JSON 字符串标量；neon 驱动 jsonb→JS string）。
 * 🔴 这条用于 relay 解析，必须**对 DB 不可达鲁棒**：任何异常/缺失/空串 → 回退（防中转因配置读失败全挂）。
 */
export async function getConfigString(key: string, fallback: string | null = null): Promise<string | null> {
  try {
    const rows = await getSql()`SELECT value_json FROM app_config WHERE key=${key}`;
    if (rows.length === 0) return fallback;
    const v = rows[0].value_json;
    return typeof v === "string" && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
