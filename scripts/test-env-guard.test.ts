// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDisposableTestEnv,
  assertLoopbackTestUrl,
  DISPOSABLE_DATABASE_ACK,
  loadDisposableTestEnv,
  parseEnvText,
  validateDisposableTestEnv,
} from "./test-env-guard";

function dbUrl(hostname: string, database: string): string {
  const value = new URL("postgresql://test.invalid");
  value.hostname = hostname;
  value.pathname = `/${database}`;
  return value.toString();
}

function validEnv(): Record<string, string> {
  return {
    MONEY_TEST_ALLOW_MUTATION: DISPOSABLE_DATABASE_ACK,
    DATABASE_URL: dbUrl("test-pooler.invalid", "isolated"),
    DATABASE_URL_UNPOOLED: dbUrl("test.invalid", "isolated"),
  };
}

describe("disposable test environment guard", () => {
  it("parses quoted values without inheriting unrelated environment", () => {
    expect(parseEnvText("A=one\nB='two words'\nexport C=three\nD: four\n# E=ignored\n")).toEqual({
      A: "one",
      B: "two words",
      C: "three",
      D: "four",
    });
  });

  it("fails closed without the exact destructive-test acknowledgement", () => {
    expect(() => validateDisposableTestEnv({ ...validEnv(), MONEY_TEST_ALLOW_MUTATION: "no" })).toThrow(
      "refusing destructive tests without disposable database acknowledgement",
    );
  });

  it("requires both test database URLs", () => {
    const env = validEnv();
    delete env.DATABASE_URL_UNPOOLED;
    expect(() => validateDisposableTestEnv(env)).toThrow(
      ".env.test must provide both disposable test database URLs",
    );
  });

  it("requires pooled and unpooled URLs to identify the same disposable database", () => {
    const env = validEnv();
    env.DATABASE_URL_UNPOOLED = dbUrl("other.invalid", "isolated");
    expect(() => validateDisposableTestEnv(env)).toThrow(
      "test database URLs must identify the same disposable database",
    );
  });

  it("rejects test URLs whose query parameters override the connection identity", () => {
    const env = validEnv();
    env.DATABASE_URL = `${env.DATABASE_URL}?host=other.invalid`;
    expect(() => validateDisposableTestEnv(env)).toThrow(
      "test database URLs must not override host, port, or database",
    );
  });

  it("rejects a production-candidate match without exposing connection details", () => {
    const testEnv = validEnv();
    const productionEnv = {
      DATABASE_URL: dbUrl("test-pooler.invalid", "isolated"),
      DATABASE_URL_UNPOOLED: dbUrl("test.invalid", "isolated"),
    };

    let message = "";
    try {
      validateDisposableTestEnv(testEnv, productionEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("[money-test] test database matches local production candidate");
    expect(message).not.toContain("test.invalid");
    expect(message).not.toContain("isolated");
  });

  it("fails closed for production candidates with implicit or overridden identities", () => {
    const testEnv = validEnv();
    const implicitDatabaseCandidate = "postgresql://isolated@test.invalid";
    const overriddenCandidate = `${dbUrl("decoy.invalid", "isolated")}?host=test.invalid`;
    const overriddenPortCandidate = `${dbUrl("test.invalid", "isolated")}?port=6543`;

    expect(() =>
      validateDisposableTestEnv(testEnv, { implicitDatabaseCandidate }),
    ).toThrow("local production database candidate has an ambiguous target");
    expect(() => validateDisposableTestEnv(testEnv, { overriddenCandidate })).toThrow(
      "local production database candidate has an ambiguous target",
    );
    expect(() => validateDisposableTestEnv(testEnv, { overriddenPortCandidate })).toThrow(
      "local production database candidate has an ambiguous target",
    );
  });

  it("normalizes a trailing hostname dot when comparing production candidates", () => {
    const testEnv = validEnv();
    const trailingDotCandidate = dbUrl("test.invalid.", "isolated");

    expect(() =>
      validateDisposableTestEnv(testEnv, { trailingDotCandidate }),
    ).toThrow("test database matches local production candidate");
  });

  it("masks root env values that are not explicitly approved by the disposable env", () => {
    const target: Record<string, string | undefined> = {
      DATABASE_URL: "inherited-database-placeholder",
      RELAY_API_KEY: "inherited-relay-placeholder",
      STORAGE_S3_SECRET_ACCESS_KEY: "inherited-storage-placeholder",
    };
    const testEnv = {
      DATABASE_URL: "disposable-database-placeholder",
      CUSTOM_KEY_MODES_ENABLED: "true",
    };

    applyDisposableTestEnv(target, testEnv, {
      DATABASE_URL: "root-database-placeholder",
      RELAY_API_KEY: "root-relay-placeholder",
      STORAGE_S3_SECRET_ACCESS_KEY: "root-storage-placeholder",
    });

    expect(target).toEqual({
      DATABASE_URL: "disposable-database-placeholder",
      RELAY_API_KEY: "",
      STORAGE_S3_SECRET_ACCESS_KEY: "",
      CUSTOM_KEY_MODES_ENABLED: "true",
    });
  });

  it("masks ambient production credentials even when they are absent from the root env", () => {
    const target: Record<string, string | undefined> = {
      PATH: "local-tool-path",
      PGPORT: "6543",
      RELAY_BASE_URL: "inherited-relay-placeholder",
      SENTRY_DSN: "inherited-observability-placeholder",
      SOME_SERVICE_TOKEN: "inherited-token-placeholder",
      E2E_REDEEM_CODE: "inherited-redeem-placeholder",
      CUSTOM_KEY_MODES_ENABLED: "false",
    };
    const testEnv = {
      CUSTOM_KEY_MODES_ENABLED: "true",
    };

    applyDisposableTestEnv(target, testEnv);

    expect(target).toEqual({
      PATH: "local-tool-path",
      PGPORT: "",
      RELAY_BASE_URL: "",
      SENTRY_DSN: "",
      SOME_SERVICE_TOKEN: "",
      E2E_REDEEM_CODE: "",
      CUSTOM_KEY_MODES_ENABLED: "true",
    });
  });

  it("rejects libpq target overrides in the disposable env", () => {
    expect(() => validateDisposableTestEnv({ ...validEnv(), PGPORT: "6543" })).toThrow(
      "must define the database target only in its URLs",
    );
  });

  it("allows only loopback browser-test targets without exposing a rejected URL", () => {
    expect(assertLoopbackTestUrl("http://localhost:8888")).toBe("http://localhost:8888");
    expect(assertLoopbackTestUrl("http://127.0.0.1:8888")).toBe("http://127.0.0.1:8888");
    expect(assertLoopbackTestUrl("http://[::1]:8888")).toBe("http://[::1]:8888");

    let message = "";
    try {
      assertLoopbackTestUrl("https://production.example.invalid");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("[e2e] browser tests require a loopback base URL");
    expect(message).not.toContain("production.example.invalid");
  });

  it("rejects an ambient database match before applying the disposable env", () => {
    const directory = mkdtempSync(join(tmpdir(), "key-mode-env-guard-"));
    const env = validEnv();
    writeFileSync(
      join(directory, ".env.test"),
      Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n"),
      "utf8",
    );
    const target: Record<string, string | undefined> = {
      DATABASE_URL: env.DATABASE_URL,
      DATABASE_URL_UNPOOLED: env.DATABASE_URL_UNPOOLED,
    };

    try {
      expect(() => loadDisposableTestEnv(directory, target)).toThrow(
        "test database matches local production candidate",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("allows a nested process that inherited the same validated disposable environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "key-mode-env-nested-"));
    const env = validEnv();
    writeFileSync(
      join(directory, ".env.test"),
      Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n"),
      "utf8",
    );
    const target: Record<string, string | undefined> = {};

    try {
      expect(() => loadDisposableTestEnv(directory, target)).not.toThrow();
      expect(() => loadDisposableTestEnv(directory, target)).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a mixed-case database match from a dotenv variant", () => {
    const directory = mkdtempSync(join(tmpdir(), "key-mode-env-variant-db-"));
    const env = validEnv();
    writeFileSync(
      join(directory, ".env.test"),
      Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n"),
      "utf8",
    );
    writeFileSync(join(directory, ".env.local"), `database_url=${env.DATABASE_URL}\n`, "utf8");

    try {
      expect(() => loadDisposableTestEnv(directory, {})).toThrow(
        "test database matches local production candidate",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pre-masks service variables found only in development dotenv variants", () => {
    const directory = mkdtempSync(join(tmpdir(), "key-mode-env-variant-mask-"));
    const env = validEnv();
    writeFileSync(
      join(directory, ".env.test"),
      Object.entries(env).map(([name, value]) => `${name}=${value}`).join("\n"),
      "utf8",
    );
    writeFileSync(
      join(directory, ".env.development.local"),
      "RELAY_API_KEY=variant-relay-placeholder\nSENTRY_DSN=variant-observability-placeholder\n",
      "utf8",
    );
    const target: Record<string, string | undefined> = {};

    try {
      loadDisposableTestEnv(directory, target);
      expect(target.RELAY_API_KEY).toBe("");
      expect(target.SENTRY_DSN).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
