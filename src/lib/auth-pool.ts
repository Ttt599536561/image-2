import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { usesPgDriver } from "../db/db-driver.server";
import { pgPoolOptions } from "../db/pool-options.server";
import { observePgPool } from "../db/pool-observer.server";

export function createAuthPool(env: NodeJS.ProcessEnv = process.env): NeonPool | PgPool {
  const connectionString = env.DATABASE_URL_UNPOOLED;
  if (usesPgDriver(env)) {
    return observePgPool(new PgPool({ connectionString, ...pgPoolOptions("auth", env) }), "auth", env);
  }
  return new NeonPool({ connectionString });
}
