export function usesPgDriver(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DATABASE_DRIVER === "pg" || env.DISPOSABLE_TEST_DB_DRIVER === "pg";
}
