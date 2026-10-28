// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sql = vi.hoisted(() => vi.fn());
vi.mock("../../db/db.server", () => ({ getSql: () => sql }));
import {
  CredentialConfigurationError,
  decryptCustomApiKey,
  encryptCustomApiKey,
  loadCustomCredential,
  loadCustomApiKey,
} from "./credential.server";

const original = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  if (original === undefined) delete process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  else process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = original;
});

describe("generation-scoped custom credential AES-GCM", () => {
  it("seals the provider URL together with its key and loads the frozen credential", async () => {
    const generationId = randomUUID();
    const encrypted = encryptCustomApiKey(generationId, "fictional-studio-key", "https://provider.example/custom/v1/");
    sql.mockResolvedValue([{ ciphertext: encrypted.ciphertext, iv: encrypted.iv, auth_tag: encrypted.authTag, key_version: encrypted.keyVersion }]);
    expect(JSON.stringify(encrypted)).not.toMatch(/fictional|provider/);
    expect(await loadCustomCredential(generationId)).toEqual({ mode: "custom", apiKey: "fictional-studio-key", baseUrl: "https://provider.example/custom/v1" });
    expect(await loadCustomApiKey(generationId)).toBe("fictional-studio-key");
    expect(() => decryptCustomApiKey(randomUUID(), encrypted)).toThrow(CredentialConfigurationError);
  });

  it("loads legacy encrypted raw keys with their existing fixed-target semantics", async () => {
    const generationId = randomUUID();
    const encrypted = encryptCustomApiKey(generationId, "fictional-legacy-key");
    sql.mockResolvedValue([{ ciphertext: encrypted.ciphertext, iv: encrypted.iv, auth_tag: encrypted.authTag, key_version: 1 }]);
    expect(await loadCustomCredential(generationId)).toEqual({ mode: "custom", apiKey: "fictional-legacy-key" });
  });

  it("rejects unsupported envelopes without exposing the credential", () => {
    const encrypted = encryptCustomApiKey(randomUUID(), "fictional-key");
    expect(() => decryptCustomApiKey(randomUUID(), { ...encrypted, keyVersion: 9 })).toThrow(CredentialConfigurationError);
  });
  it("round trips without placing plaintext in encrypted fields", () => {
    const generationId = randomUUID();
    const plaintext = "fictional-key-material";
    const encrypted = encryptCustomApiKey(generationId, plaintext);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(encrypted.keyVersion).toBe(1);
    expect(decryptCustomApiKey(generationId, encrypted)).toBe(plaintext);
  });

  it("accepts the installer's canonical unpadded base64url master key", () => {
    process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = Buffer.alloc(32, 251).toString("base64url");
    const generationId = randomUUID();
    const encrypted = encryptCustomApiKey(generationId, "installer-generated-key-format");
    expect(decryptCustomApiKey(generationId, encrypted)).toBe("installer-generated-key-format");
  });

  it("uses a random 96-bit IV", () => {
    const generationId = randomUUID();
    const first = encryptCustomApiKey(generationId, "same-fictional-value");
    const second = encryptCustomApiKey(generationId, "same-fictional-value");
    expect(first.iv).not.toBe(second.iv);
    expect(Buffer.from(first.iv, "base64")).toHaveLength(12);
  });

  it("binds ciphertext to its generation id as authenticated data", () => {
    const generationA = randomUUID();
    const generationB = randomUUID();
    const encrypted = encryptCustomApiKey(generationA, "fictional-bound-value");
    expect(() => decryptCustomApiKey(generationB, encrypted)).toThrow(CredentialConfigurationError);
    expect(() => decryptCustomApiKey(generationB, encrypted)).toThrow(
      "custom credential encryption is unavailable",
    );
  });

  it("fails closed with a fixed message for an invalid master key", () => {
    process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY = "invalid";
    expect(() => encryptCustomApiKey(randomUUID(), "fictional-value")).toThrow(
      CredentialConfigurationError,
    );
    expect(() => encryptCustomApiKey(randomUUID(), "fictional-value")).toThrow(
      "custom credential encryption is unavailable",
    );
  });
});
