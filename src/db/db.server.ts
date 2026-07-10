// ★server-only：Neon 两种调用模式（00-overview.md §1.3）。
//  ① 事务模式（钱/码必用）—— Pool over WebSocket（DATABASE_URL_UNPOOLED / direct），支持跨语句事务 + FOR UPDATE。
//  ② HTTP 模式（兑换单语句 / 看板只读聚合）—— neon()（DATABASE_URL / pooled），单次往返、最快、不支持事务。
//
// 🔴 红线：凡「读-改-写多步且防并发双花」（扣费 FIFO / 注册原子发放 / 退款 / 调账）必须走 ① 事务模式；
//    HTTP 单语句不支持 FOR UPDATE / 跨语句事务，拿它防双花会落空（00 §1.3）。
//    DB client / pool 单 handler 内「开-用-关」、绝不跨请求复用（serverless 无常驻进程）。
//
// 注：本文件只负责「连接工厂」。事务编排助手 tx() 在 src/server/tx.server.ts（阶段二 §3）。

import { neon, type NeonQueryFunction, Pool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import ws from "ws";

// Node 运行时需注入 ws 给 Neon Pool（浏览器/Edge 有原生 WebSocket 时不需要；此文件 server-only）。
if (!neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[db] 缺少环境变量 ${name}（接真 Neon 前需配置，见 PHASE2-PLAN §0）`);
  return v;
}

export interface DbQueryResult<Row = Record<string, any>> {
  rows: Row[];
  rowCount: number | null;
}

export interface DbPoolClient {
  query<Row = Record<string, any>>(queryText: string, values?: any[]): Promise<DbQueryResult<Row>>;
  release(): void;
}

export interface DbPool {
  connect(): Promise<DbPoolClient>;
  end(): Promise<void>;
}

export interface SqlClient {
  (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
}

function usesDisposableLocalPostgres(): boolean {
  return process.env.DISPOSABLE_TEST_DB_DRIVER === "pg";
}

let localReadPool: PgPool | undefined;

function getLocalReadPool(): PgPool {
  localReadPool ??= new PgPool({
    connectionString: requireEnv("DATABASE_URL"),
    allowExitOnIdle: true,
    max: 4,
  });
  return localReadPool;
}

/**
 * ① 事务连接池（Pool/WS over DATABASE_URL_UNPOOLED, direct endpoint）。
 * 用于钱/码事务：connect → BEGIN → … FOR UPDATE … → COMMIT/ROLLBACK → release → end。
 * 每个 handler 内新建、用完即 end()，不跨请求复用。事务编排见 tx.server.ts。
 */
export function getPool(): DbPool {
  if (usesDisposableLocalPostgres()) {
    return new PgPool({
      connectionString: requireEnv("DATABASE_URL_UNPOOLED"),
      allowExitOnIdle: true,
      max: 4,
    }) as unknown as DbPool;
  }
  return new Pool({ connectionString: requireEnv("DATABASE_URL_UNPOOLED") }) as unknown as DbPool;
}

/**
 * ② HTTP 单语句客户端（neon() over DATABASE_URL, pooled endpoint）。
 * 用于看板只读聚合、单语句原子写（兑换核销 UPDATE…RETURNING）、cron 只读扫描。
 * 不支持 FOR UPDATE / 跨语句事务。
 */
export function getSql(): SqlClient {
  if (usesDisposableLocalPostgres()) {
    const pool = getLocalReadPool();
    return (async (strings: TemplateStringsArray, ...values: any[]) => {
      let queryText = strings[0] ?? "";
      for (let index = 0; index < values.length; index += 1) {
        queryText += `$${index + 1}${strings[index + 1] ?? ""}`;
      }
      const result = await pool.query(queryText, values);
      return result.rows;
    }) as SqlClient;
  }
  return neon(requireEnv("DATABASE_URL")) as unknown as NeonQueryFunction<false, false> as SqlClient;
}
