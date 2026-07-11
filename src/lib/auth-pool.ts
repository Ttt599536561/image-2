import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";

export function createAuthPool(env: NodeJS.ProcessEnv = process.env): NeonPool | PgPool {
  const connectionString = env.DATABASE_URL_UNPOOLED;
  if (env.DISPOSABLE_TEST_DB_DRIVER === "pg") {
    return new PgPool({ connectionString, allowExitOnIdle: true, max: 4 });
  }
  return new NeonPool({ connectionString });
}
