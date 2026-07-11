import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { usesPgDriver } from "../db/db-driver.server";

export function createAuthPool(env: NodeJS.ProcessEnv = process.env): NeonPool | PgPool {
  const connectionString = env.DATABASE_URL_UNPOOLED;
  if (usesPgDriver(env)) {
    return new PgPool({ connectionString, allowExitOnIdle: true, max: 4 });
  }
  return new NeonPool({ connectionString });
}
