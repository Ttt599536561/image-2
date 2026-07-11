import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { parse as parsePgConnectionString } from "pg-connection-string";

export const DISPOSABLE_DATABASE_ACK = "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE";
const APPLIED_DATABASE_FINGERPRINT = "DISPOSABLE_TEST_DATABASE_FINGERPRINT";
const PRODUCTION_ENV_FILE_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
] as const;

const PRODUCTION_SERVICE_PREFIXES = [
  "ANTHROPIC",
  "AUTH",
  "AWS",
  "BETTER_AUTH",
  "CLOUDFLARE",
  "CUSTOM_KEY",
  "DATABASE",
  "DISCORD",
  "E2E",
  "NEON",
  "NETLIFY",
  "OPENAI",
  "POSTGRES",
  "R2",
  "RELAY",
  "RESEND",
  "S3",
  "SENTRY",
  "SLACK",
  "SMTP",
  "STORAGE",
  "STRIPE",
  "SUPABASE",
  "TURNSTILE",
  "VERCEL",
] as const;

const POSTGRES_CLIENT_ENV_NAMES = new Set([
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGOPTIONS",
  "PGPASSWORD",
  "PGPORT",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGUSER",
]);

const POSTGRES_TARGET_OVERRIDE_NAMES = [
  "PGDATABASE",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGSERVICE",
  "PGSERVICEFILE",
] as const;

function isProductionSensitiveEnvName(name: string): boolean {
  const normalized = name.toUpperCase();
  if (POSTGRES_CLIENT_ENV_NAMES.has(normalized)) return true;
  if (
    PRODUCTION_SERVICE_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`),
    )
  ) {
    return true;
  }
  return /(?:^|_)(?:API_KEY|CONNECTION_STRING|CREDENTIALS?|DSN|KEY|PASSWORD|SECRET|TOKEN|WEBHOOK)(?:_|$)/.test(
    normalized,
  );
}

function envValues(
  source: Record<string, string | undefined>,
  expectedName: string,
): string[] {
  const normalized = expectedName.toUpperCase();
  return Object.entries(source)
    .filter(([name, value]) => name.toUpperCase() === normalized && Boolean(value))
    .map(([, value]) => value as string);
}

function envValue(
  source: Record<string, string | undefined>,
  expectedName: string,
): string | undefined {
  return envValues(source, expectedName)[0];
}

export function assertLoopbackTestUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
    ) {
      return parsed.origin;
    }
  } catch {
    // Rejected below without echoing the supplied target.
  }
  throw new Error("[e2e] browser tests require a loopback base URL");
}

export function parseEnvText(raw: string): Record<string, string> {
  return parseDotenv(raw);
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.+$/, "");
}

function normalizeDatabaseEndpoint(value: string): string {
  return normalizeHostname(value).replace(/-pooler(?=\.|$)/, "");
}

type DatabaseIdentityPolicy = "test" | "production-candidate";

const AMBIGUOUS_PRODUCTION_DATABASE_TARGET =
  "[money-test] local production database candidate has an ambiguous target";

function databaseFingerprint(value: string, policy: DatabaseIdentityPolicy): string {
  const hasPostgresScheme = /^postgres(?:ql)?:/i.test(value.trim());
  if (!hasPostgresScheme) throw new TypeError("invalid PostgreSQL URL");

  let authority: URL;
  try {
    authority = new URL(value);
  } catch (error) {
    if (policy === "production-candidate") {
      throw new Error(AMBIGUOUS_PRODUCTION_DATABASE_TARGET);
    }
    throw error;
  }
  if (authority.protocol !== "postgres:" && authority.protocol !== "postgresql:") {
    throw new TypeError("invalid PostgreSQL URL");
  }

  let parsed: ReturnType<typeof parsePgConnectionString>;
  try {
    parsed = parsePgConnectionString(value);
  } catch (error) {
    if (policy === "production-candidate") {
      throw new Error(AMBIGUOUS_PRODUCTION_DATABASE_TARGET);
    }
    throw error;
  }
  const host = typeof parsed.host === "string" ? normalizeHostname(parsed.host) : "";
  const port = typeof parsed.port === "string" && parsed.port ? parsed.port : "5432";
  const database = typeof parsed.database === "string" ? parsed.database : "";
  const authorityHost = normalizeHostname(authority.hostname);
  const authorityPort = authority.port || "5432";
  let authorityDatabase = "";
  try {
    authorityDatabase = authority.pathname.slice(1)
      ? decodeURI(authority.pathname.slice(1))
      : "";
  } catch (error) {
    if (policy === "production-candidate") {
      throw new Error(AMBIGUOUS_PRODUCTION_DATABASE_TARGET);
    }
    throw error;
  }
  const hasIdentityQuery = [...authority.searchParams.keys()].some((name) =>
    ["database", "dbname", "host", "hostaddr", "port"].includes(name.toLowerCase()),
  );
  const identityDiffers =
    host !== authorityHost || port !== authorityPort || database !== authorityDatabase;

  if (policy === "production-candidate") {
    if (!host || !database || !authorityHost || !authorityDatabase || hasIdentityQuery || identityDiffers) {
      throw new Error(AMBIGUOUS_PRODUCTION_DATABASE_TARGET);
    }
  } else if (!host || !database) {
    throw new TypeError("incomplete PostgreSQL URL");
  } else if (hasIdentityQuery || identityDiffers) {
    throw new Error(
      "[money-test] test database URLs must not override host, port, or database",
    );
  }

  const endpoint = normalizeDatabaseEndpoint(host);
  return createHash("sha256").update(`${endpoint}:${port}/${database}`).digest("hex");
}

export function validateDisposableTestEnv(
  testEnv: Record<string, string>,
  productionCandidates: Record<string, string> = {},
): void {
  if (testEnv.MONEY_TEST_ALLOW_MUTATION !== DISPOSABLE_DATABASE_ACK) {
    throw new Error("[money-test] refusing destructive tests without disposable database acknowledgement");
  }
  if (!testEnv.DATABASE_URL || !testEnv.DATABASE_URL_UNPOOLED) {
    throw new Error("[money-test] .env.test must provide both disposable test database URLs");
  }
  if (POSTGRES_TARGET_OVERRIDE_NAMES.some((name) => envValues(testEnv, name).length > 0)) {
    throw new Error("[money-test] .env.test must define the database target only in its URLs");
  }

  let testFingerprints: Set<string>;
  try {
    testFingerprints = new Set([
      databaseFingerprint(testEnv.DATABASE_URL, "test"),
      databaseFingerprint(testEnv.DATABASE_URL_UNPOOLED, "test"),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[money-test]")) throw error;
    throw new Error("[money-test] .env.test must provide valid disposable test database URLs");
  }
  if (testFingerprints.size !== 1) {
    throw new Error("[money-test] test database URLs must identify the same disposable database");
  }

  for (const candidate of Object.values(productionCandidates)) {
    if (!candidate) continue;
    try {
      if (testFingerprints.has(databaseFingerprint(candidate, "production-candidate"))) {
        throw new Error("[money-test] test database matches local production candidate");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[money-test]")) throw error;
      // Invalid local production placeholders are not database candidates.
    }
  }
}

export function applyDisposableTestEnv(
  target: Record<string, string | undefined>,
  testEnv: Record<string, string>,
  productionCandidates: Record<string, string> = {},
): void {
  const approvedNames = new Set(Object.keys(testEnv).map((name) => name.toUpperCase()));
  for (const name of Object.keys(target)) {
    if (!approvedNames.has(name.toUpperCase()) && isProductionSensitiveEnvName(name)) {
      target[name] = "";
    }
  }
  for (const name of Object.keys(productionCandidates)) {
    if (approvedNames.has(name.toUpperCase())) continue;
    for (const targetName of Object.keys(target)) {
      if (targetName.toUpperCase() === name.toUpperCase()) target[targetName] = "";
    }
    target[name] = "";
  }
  for (const [name, value] of Object.entries(testEnv)) {
    for (const targetName of Object.keys(target)) {
      if (targetName !== name && targetName.toUpperCase() === name.toUpperCase()) {
        target[targetName] = "";
      }
    }
    target[name] = value;
  }
}

export function loadDisposableTestEnv(
  cwd = process.cwd(),
  target: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const testEnvPath = resolve(cwd, ".env.test");
  let testEnv: Record<string, string>;
  try {
    testEnv = parseEnvText(readFileSync(testEnvPath, "utf8"));
  } catch {
    throw new Error("[money-test] a gitignored .env.test file is required");
  }

  const productionSources = PRODUCTION_ENV_FILE_NAMES.flatMap((fileName) => {
    const path = resolve(cwd, fileName);
    return existsSync(path) ? [{ fileName, values: parseEnvText(readFileSync(path, "utf8")) }] : [];
  });
  const productionCandidates: Record<string, string> = {};
  for (const source of productionSources) {
    Object.assign(productionCandidates, source.values);
  }
  validateDisposableTestEnv(testEnv);
  const testFingerprint = databaseFingerprint(testEnv.DATABASE_URL, "test");
  const databaseCandidates: Record<string, string> = {};
  for (const [sourceIndex, source] of productionSources.entries()) {
    for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
      envValues(source.values, name).forEach((value, valueIndex) => {
        databaseCandidates[`file${sourceIndex}-${name}-${valueIndex}`] = value;
      });
    }
  }
  if (envValue(target, APPLIED_DATABASE_FINGERPRINT) !== testFingerprint) {
    for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
      envValues(target, name).forEach((value, valueIndex) => {
        databaseCandidates[`ambient-${name}-${valueIndex}`] = value;
      });
    }
  }
  validateDisposableTestEnv(testEnv, databaseCandidates);
  applyDisposableTestEnv(target, testEnv, productionCandidates);
  target[APPLIED_DATABASE_FINGERPRINT] = testFingerprint;
  return testEnv;
}

async function runCli(): Promise<void> {
  loadDisposableTestEnv();
  const target = process.argv[2];
  if (!target) return;
  const targetPath = resolve(process.cwd(), target);
  process.argv = [process.execPath, targetPath, ...process.argv.slice(3)];
  await import(pathToFileURL(targetPath).href);
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  await runCli();
}
