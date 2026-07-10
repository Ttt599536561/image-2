// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialConfigurationError,
  decryptCustomApiKey,
  encryptCustomApiKey,
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
  it("round trips without placing plaintext in encrypted fields", () => {
    const generationId = randomUUID();
    const plaintext = "fictional-key-material";
    const encrypted = encryptCustomApiKey(generationId, plaintext);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(encrypted.keyVersion).toBe(1);
    expect(decryptCustomApiKey(generationId, encrypted)).toBe(plaintext);
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
