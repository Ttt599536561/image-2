import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSql } from "../../db/db.server";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";
export const CUSTOM_CREDENTIAL_KEY_VERSION = 1;

export class CredentialConfigurationError extends Error {
  constructor() {
    super("custom credential encryption is unavailable");
    this.name = "CredentialConfigurationError";
  }
}

export interface EncryptedCustomApiKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function masterKey(): Buffer {
  const raw = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY;
  if (!raw) throw new CredentialConfigurationError();

  for (const encoding of ["base64", "base64url"] as const) {
    const key: Buffer = Buffer.from(raw, encoding);
    if (key.length === 32 && key.toString(encoding) === raw) return key;
  }
  throw new CredentialConfigurationError();
}

function authenticatedGenerationId(generationId: string): Buffer {
  return Buffer.from(generationId, "utf8");
}

export function encryptCustomApiKey(
  generationId: string,
  apiKey: string,
): EncryptedCustomApiKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(authenticatedGenerationId(generationId));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CUSTOM_CREDENTIAL_KEY_VERSION,
  };
}

export function decryptCustomApiKey(
  generationId: string,
  value: EncryptedCustomApiKey,
): string {
  if (value.keyVersion !== CUSTOM_CREDENTIAL_KEY_VERSION) {
    throw new CredentialConfigurationError();
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(value.iv, "base64"));
    decipher.setAAD(authenticatedGenerationId(generationId));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CredentialConfigurationError();
  }
}

export async function loadCustomApiKey(generationId: string): Promise<string> {
  const rows = await getSql()`SELECT ciphertext,iv,auth_tag,key_version
                              FROM generation_credentials
                              WHERE generation_id=${generationId} AND expires_at>now()`;
  const row = rows[0];
  if (!row) throw new CredentialConfigurationError();
  return decryptCustomApiKey(generationId, {
    ciphertext: row.ciphertext as string,
    iv: row.iv as string,
    authTag: row.auth_tag as string,
    keyVersion: Number(row.key_version),
  });
}

export async function deleteGenerationCredential(generationId: string): Promise<void> {
  await getSql()`DELETE FROM generation_credentials WHERE generation_id=${generationId}`;
}

export async function deleteExpiredGenerationCredentials(now?: Date): Promise<number> {
  const rows = now
    ? await getSql()`DELETE FROM generation_credentials WHERE expires_at<=${now.toISOString()} RETURNING generation_id`
    : await getSql()`DELETE FROM generation_credentials WHERE expires_at<=now() RETURNING generation_id`;
  return rows.length;
}
