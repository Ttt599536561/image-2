import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DISPOSABLE_DATABASE_ACK = "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE";

export function parseEnvText(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq <= 0) continue;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function databaseFingerprint(value: string): string {
  const parsed = new URL(value);
  const endpoint = parsed.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, "");
  return createHash("sha256").update(`${endpoint}${parsed.pathname}`).digest("hex");
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

  let testFingerprints: Set<string>;
  try {
    testFingerprints = new Set([
      databaseFingerprint(testEnv.DATABASE_URL),
      databaseFingerprint(testEnv.DATABASE_URL_UNPOOLED),
    ]);
  } catch {
    throw new Error("[money-test] .env.test must provide valid disposable test database URLs");
  }

  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const candidate = productionCandidates[name];
    if (!candidate) continue;
    try {
      if (testFingerprints.has(databaseFingerprint(candidate))) {
        throw new Error("[money-test] test database matches local production candidate");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[money-test]")) throw error;
      // Invalid local production placeholders are not database candidates.
    }
  }
}

export function loadDisposableTestEnv(cwd = process.cwd()): Record<string, string> {
  const testEnvPath = resolve(cwd, ".env.test");
  let testEnv: Record<string, string>;
  try {
    testEnv = parseEnvText(readFileSync(testEnvPath, "utf8"));
  } catch {
    throw new Error("[money-test] a gitignored .env.test file is required");
  }

  const productionPath = resolve(cwd, ".env");
  const productionCandidates = existsSync(productionPath)
    ? parseEnvText(readFileSync(productionPath, "utf8"))
    : {};
  validateDisposableTestEnv(testEnv, productionCandidates);
  Object.assign(process.env, testEnv);
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
