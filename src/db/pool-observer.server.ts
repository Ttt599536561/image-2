import type { Pool } from "pg";
import type { PoolRole } from "./pool-options.server";
import { performance } from "node:perf_hooks";

/** Opt-in timings only: never log SQL, parameters, connection strings or error text. */
export function observePgPool(pool: Pool, role: PoolRole, env: NodeJS.ProcessEnv = process.env): Pool {
  if (env.DB_TIMING_ENABLED !== "true") return pool;
  const clients = new WeakSet<object>();
  const measure = (operation: (...args: any[]) => any, phase: "acquire" | "query", onSuccess?: (value: any) => void) =>
    function (...args: any[]) {
      const start = performance.now();
      let reported = false;
      const done = (error: unknown) => {
        if (reported) return;
        reported = true;
        try {
          console.log("[db-timing]", JSON.stringify({
            role, phase, ms: Math.round((performance.now() - start) * 100) / 100,
            ok: !error, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
          }));
        } catch { /* Diagnostics must not affect the database operation. */ }
      };
      const callback = args.at(-1);
      if (typeof callback === "function") {
        args[args.length - 1] = (error: unknown, ...values: any[]) => {
          if (!error) onSuccess?.(values[0]);
          done(error);
          return callback(error, ...values);
        };
      }
      try {
        const result = operation(...args);
        if (result && typeof result.then === "function") {
          return result.then((value: any) => {
            onSuccess?.(value);
            done(null);
            return value;
          }, (error: unknown) => { done(error); throw error; });
        }
        return result;
      } catch (error) {
        done(error);
        throw error;
      }
    };
  pool.connect = measure(pool.connect.bind(pool), "acquire", (client) => {
    if (!client || clients.has(client)) return;
    clients.add(client);
    client.query = measure(client.query.bind(client), "query");
  }) as typeof pool.connect;
  return pool;
}
