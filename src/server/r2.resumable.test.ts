// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as storage from "./r2.server";
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "resumable-storage-")); vi.stubEnv("STORAGE_DRIVER", "local"); vi.stubEnv("LOCAL_STORAGE_ROOT", directory); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
it("recovers the identical immutable key after a lost write response", async () => {
  const bytes = new Uint8Array([1, 2, 3]), storageKey = "uploads/owner/2026/10/stable.png";
  const write = storage.putUserUploadAtKey;
  expect(write).toBeTypeOf("function");
  const args = { storageKey, bytes, contentType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") };
  await write(args); await write(args);
  expect((await storage.getUploadObject(storageKey)).bytes).toEqual(bytes);
});
it("does not accept or overwrite a different existing object", async () => {
  const storageKey = "uploads/owner/2026/10/conflict.png";
  const write = storage.putUserUploadAtKey;
  expect(write).toBeTypeOf("function");
  const first = new Uint8Array([1, 2, 3]), second = new Uint8Array([3, 2, 1]);
  const args = (bytes: Uint8Array) => ({ storageKey, bytes, contentType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") });
  await write(args(first));
  await expect(write(args(second))).rejects.toThrow("stored upload conflict");
  expect((await storage.getUploadObject(storageKey)).bytes).toEqual(first);
});
