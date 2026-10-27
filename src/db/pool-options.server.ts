import type { PoolConfig } from "pg";

export type PoolRole = "read" | "transaction" | "auth";

function integerSetting(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`[db] ${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

export function pgPoolOptions(role: PoolRole, env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    allowExitOnIdle: true,
    max: integerSetting(env, `PG_${role.toUpperCase()}_POOL_MAX`, 4, 64),
    connectionTimeoutMillis: integerSetting(env, "PG_CONNECTION_TIMEOUT_MS", 10_000, 60_000),
  };
}
