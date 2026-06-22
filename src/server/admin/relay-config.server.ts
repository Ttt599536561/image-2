// ★server-only：后台中转站配置（base_url + api_key，存 app_config 的 JSON 字符串标量）。
// relay.ts 读时 app_config 优先、回退 env（换厂商即时生效，无需改代码/重部署）。
//
// 🔴 红线：
//  - api_key **写后即焚**——GET 永不回明文，只回「是否已配 + 末 4 位 hint」；审计 before/after 绝不落 key 明文（仅 hint+changed）。
//  - base_url 非密，可读可写明文。
//  - 写校验失败抛 Response（与 config.server.ts 同范式，路由 catch instanceof Response 直接回）。
import { getSql } from "../../db/db.server";
import { getConfigString } from "../config.server";
import { writeAuditHttp } from "./audit.server";

export interface RelayConfigView {
  baseUrl: string; // 当前生效 base（config 优先、回退 env），可能为空串
  baseUrlSource: "config" | "env" | "none";
  hasKey: boolean; // 是否已配 key（config 或 env）
  keySource: "config" | "env" | "none";
  keyHint: string | null; // 末 4 位提示（如 "…a1b2"），绝不回全量
}

/** key 脱敏：只露末 4 位（极短 key 也不全显）。 */
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const k = key.trim();
  if (!k) return null;
  return k.length <= 4 ? `…${k.slice(-2)}` : `…${k.slice(-4)}`;
}

/** 读当前中转配置（脱敏）。base_url 回当前生效值；key 只回是否已配 + 末 4 位 + 来源。 */
export async function getRelayConfig(): Promise<RelayConfigView> {
  const cfgBase = await getConfigString("relay_base_url");
  const cfgKey = await getConfigString("relay_api_key");
  const envBase = process.env.RELAY_BASE_URL || "";
  const envKey = process.env.RELAY_API_KEY || "";
  const baseUrl = cfgBase || envBase || "";
  const effectiveKey = cfgKey || envKey || "";
  return {
    baseUrl,
    baseUrlSource: cfgBase ? "config" : envBase ? "env" : "none",
    hasKey: Boolean(effectiveKey),
    keySource: cfgKey ? "config" : envKey ? "env" : "none",
    keyHint: maskKey(effectiveKey),
  };
}

/** 写 app_config 的 JSON 字符串标量（与 getConfigString 读约定一致）。 */
async function setStringConfig(key: string, value: string): Promise<void> {
  const sql = getSql();
  const json = JSON.stringify(value);
  await sql`
    INSERT INTO app_config(key, value_json, updated_at)
    VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value_json = ${json}::jsonb, updated_at = now()`;
}

/**
 * 写中转配置。baseUrl 提供且非空即写（http(s) 校验）；apiKey 仅在非空时写（写后即焚、不回显）。
 * 审计 before/after：base 明文，key 绝不落明文（只标 changed + hint）。返回各字段是否更新。
 */
export async function updateRelayConfig(args: {
  adminId: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  ip?: string | null;
}): Promise<{ updatedBaseUrl: boolean; updatedKey: boolean }> {
  const before = await getRelayConfig(); // 脱敏快照
  const baseUrl = args.baseUrl?.trim();
  const apiKey = args.apiKey?.trim();

  let updatedBaseUrl = false;
  let updatedKey = false;

  if (baseUrl) {
    if (!/^https?:\/\/.+/i.test(baseUrl)) throw new Response("中转 URL 须以 http(s):// 开头", { status: 400 });
    await setStringConfig("relay_base_url", baseUrl);
    updatedBaseUrl = true;
  }
  if (apiKey) {
    await setStringConfig("relay_api_key", apiKey);
    updatedKey = true;
  }
  if (!updatedBaseUrl && !updatedKey) throw new Response("无改动", { status: 400 });

  const after = await getRelayConfig();
  await writeAuditHttp({
    adminId: args.adminId,
    action: "edit_relay_config",
    targetType: "config",
    before: { baseUrl: before.baseUrl, key: { hint: before.keyHint } },
    after: {
      baseUrl: after.baseUrl,
      key: updatedKey ? { changed: true, hint: after.keyHint } : { hint: after.keyHint },
    },
    ip: args.ip ?? null,
  });
  return { updatedBaseUrl, updatedKey };
}
