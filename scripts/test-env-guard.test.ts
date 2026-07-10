// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DISPOSABLE_DATABASE_ACK,
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
    expect(parseEnvText("A=one\nB='two words'\n# C=ignored\n")).toEqual({
      A: "one",
      B: "two words",
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
});
