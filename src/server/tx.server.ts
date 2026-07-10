// ★server-only：钱/码事务编排（00 §1.3 / 03）。Pool/WS over DATABASE_URL_UNPOOLED，
// connect → BEGIN → fn → COMMIT/ROLLBACK → release → end（单 handler 内开-用-关，不跨请求复用）。
//
// 🔴 红线：凡「读-改-写多步 + 防并发双花」（扣费 FIFO / 注册原子发放 / 兑换 / 调账）必须走这里 + FOR UPDATE；
//    HTTP 单语句模式不支持事务/FOR UPDATE，拿它防双花会落空。
import { type DbPoolClient, getPool } from "../db/db.server";

// 事务客户端类型（neon 的 connect() 有 callback 重载，ReturnType 会取到 void，故直接用 PoolClient）。
export type TxClient = DbPoolClient;

export async function tx<T>(fn: (c: TxClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      // ROLLBACK 失败（连接已断）→ 忽略，抛原始错误
    }
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
