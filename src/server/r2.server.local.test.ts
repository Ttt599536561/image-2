// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteLocalStorageObject,
  isLocalStorageEnabled,
  localStoragePublicUrl,
  readLocalStorageObject,
  storageKeyFromLocalPublicUrl,
  writeLocalStorageObject,
} from "./local-storage.server";
import {
  deleteFromR2,
  deleteManyFromR2,
  getUploadObject,
  listStorageObjects,
  putToR2,
  putUserUpload,
  storageKeyFromPublicUrl,
} from "./r2.server";
import * as r2Storage from "./r2.server";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("disposable local object storage", () => {
  let directory = "";
  let outsideDirectory = "";
  const originalStorageDriver = process.env.STORAGE_DRIVER;
  const originalDriver = process.env.DISPOSABLE_TEST_DB_DRIVER;
  const originalStorageRoot = process.env.LOCAL_STORAGE_ROOT;
  const originalRoot = process.env.LOCAL_TEST_STORAGE_ROOT;
  const originalAuthUrl = process.env.BETTER_AUTH_URL;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "key-mode-local-storage-"));
    outsideDirectory = mkdtempSync(join(tmpdir(), "key-mode-outside-storage-"));
    delete process.env.STORAGE_DRIVER;
    process.env.DISPOSABLE_TEST_DB_DRIVER = "pg";
    delete process.env.LOCAL_STORAGE_ROOT;
    process.env.LOCAL_TEST_STORAGE_ROOT = directory;
    process.env.BETTER_AUTH_URL = "http://localhost:8888";
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
    if (originalStorageDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = originalStorageDriver;
    if (originalDriver === undefined) delete process.env.DISPOSABLE_TEST_DB_DRIVER;
    else process.env.DISPOSABLE_TEST_DB_DRIVER = originalDriver;
    if (originalStorageRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
    else process.env.LOCAL_STORAGE_ROOT = originalStorageRoot;
    if (originalRoot === undefined) delete process.env.LOCAL_TEST_STORAGE_ROOT;
    else process.env.LOCAL_TEST_STORAGE_ROOT = originalRoot;
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
  });

  it("stores generated images behind a relative local public URL", async () => {
    const result = await putToR2("user-id", "generation-id", {
      b64_json: ONE_PIXEL_PNG.toString("base64"),
    });

    expect(result.publicUrl).toMatch(/^\/media\//);
    expect(result.sizeBytes).toBe(ONE_PIXEL_PNG.byteLength);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);

    const stored = await readLocalStorageObject(result.storageKey);
    expect(Buffer.from(stored.bytes)).toEqual(ONE_PIXEL_PNG);
  });

  it("reads a generated image through the generic server storage adapter", async () => {
    const result = await putToR2("user-id", "generation-id", {
      b64_json: ONE_PIXEL_PNG.toString("base64"),
    });
    const reader = (
      r2Storage as typeof r2Storage & {
        getStoredImageObject?: (storageKey: string) => Promise<{
          bytes: Uint8Array;
          contentType: string;
          filename: string;
        }>;
      }
    ).getStoredImageObject;

    expect(reader).toBeTypeOf("function");
    if (!reader) return;
    const loaded = await reader(result.storageKey);
    expect(Buffer.from(loaded.bytes)).toEqual(ONE_PIXEL_PNG);
    expect(loaded.contentType).toBe("image/png");
  });

  it("round-trips and deletes reference uploads without S3 credentials", async () => {
    const stored = await putUserUpload({
      userId: "user-id",
      bytes: ONE_PIXEL_PNG,
      contentType: "image/png",
      ext: "png",
    });
    const loaded = await getUploadObject(stored.storageKey);

    expect(Buffer.from(loaded.bytes)).toEqual(ONE_PIXEL_PNG);
    expect(loaded.contentType).toBe("image/png");
    await deleteFromR2(stored.storageKey);
    await expect(getUploadObject(stored.storageKey)).rejects.toThrow();
  });

  it("rejects symlink and junction escapes for reads, writes, and deletes", async () => {
    const sentinel = join(outsideDirectory, "probe.png");
    writeFileSync(sentinel, ONE_PIXEL_PNG);
    symlinkSync(
      outsideDirectory,
      join(directory, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(readLocalStorageObject("escape/probe.png")).rejects.toThrow(
      "invalid storage key",
    );
    await expect(writeLocalStorageObject("escape/new.png", ONE_PIXEL_PNG)).rejects.toThrow(
      "invalid storage key",
    );
    await expect(deleteLocalStorageObject("escape/probe.png")).rejects.toThrow(
      "invalid storage key",
    );
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(outsideDirectory, "new.png"))).toBe(false);
  });
});

describe("persistent local object storage", () => {
  let directory = "";
  let secondaryDirectory = "";
  let outsideDirectory = "";
  const environmentKeys = [
    "STORAGE_DRIVER",
    "DISPOSABLE_TEST_DB_DRIVER",
    "LOCAL_STORAGE_ROOT",
    "LOCAL_TEST_STORAGE_ROOT",
    "BETTER_AUTH_URL",
    "STORAGE_PUBLIC_BASE_URL",
    "STORAGE_S3_ENDPOINT",
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
    "STORAGE_BUCKET",
  ] as const;
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "persistent-local-storage-"));
    secondaryDirectory = mkdtempSync(join(tmpdir(), "persistent-local-storage-secondary-"));
    outsideDirectory = mkdtempSync(join(tmpdir(), "persistent-local-storage-outside-"));
    for (const key of environmentKeys) originalEnvironment.set(key, process.env[key]);

    process.env.STORAGE_DRIVER = "local";
    delete process.env.DISPOSABLE_TEST_DB_DRIVER;
    process.env.LOCAL_STORAGE_ROOT = directory;
    process.env.LOCAL_TEST_STORAGE_ROOT = secondaryDirectory;
    process.env.BETTER_AUTH_URL = "https://images.example";
    delete process.env.STORAGE_PUBLIC_BASE_URL;
    delete process.env.STORAGE_S3_ENDPOINT;
    delete process.env.STORAGE_S3_ACCESS_KEY_ID;
    delete process.env.STORAGE_S3_SECRET_ACCESS_KEY;
    delete process.env.STORAGE_BUCKET;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(secondaryDirectory, { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
    for (const key of environmentKeys) {
      const original = originalEnvironment.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    originalEnvironment.clear();
  });

  it("enables explicit local storage and prefers LOCAL_STORAGE_ROOT", async () => {
    expect(isLocalStorageEnabled({ STORAGE_DRIVER: "local" })).toBe(true);
    expect(isLocalStorageEnabled({ DISPOSABLE_TEST_DB_DRIVER: "pg" })).toBe(true);
    expect(isLocalStorageEnabled({ STORAGE_DRIVER: "s3" })).toBe(false);

    const key = "root-precedence/probe.png";
    await writeLocalStorageObject(key, ONE_PIXEL_PNG);
    expect(existsSync(join(directory, key))).toBe(true);
    expect(existsSync(join(secondaryDirectory, key))).toBe(false);
  });

  it("stores generated images with an encoded relative media URL and preserves dimensions", async () => {
    const result = await putToR2("user with space", "generation-id", {
      b64_json: ONE_PIXEL_PNG.toString("base64"),
    });

    expect(result.publicUrl).toMatch(/^\/media\//);
    expect(result.publicUrl).toContain("user%20with%20space");
    expect(storageKeyFromPublicUrl(`https://images.example${result.publicUrl}`)).toBe(
      result.storageKey,
    );
    expect(result.sizeBytes).toBe(ONE_PIXEL_PNG.byteLength);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(readFileSync(join(directory, result.storageKey))).toEqual(ONE_PIXEL_PNG);
  });

  it("completes the local upload, list, batch-delete, and single-delete lifecycle", async () => {
    const first = await putUserUpload({
      userId: "user with space",
      bytes: ONE_PIXEL_PNG,
      contentType: "image/png",
      ext: "png",
    });
    const second = await putUserUpload({
      userId: "another-user",
      bytes: ONE_PIXEL_PNG,
      contentType: "image/png",
      ext: "png",
    });

    const loaded = await getUploadObject(first.storageKey);
    expect(Buffer.from(loaded.bytes)).toEqual(ONE_PIXEL_PNG);
    expect(loaded.contentType).toBe("image/png");

    const listedBeforeDelete = await listStorageObjects();
    expect(listedBeforeDelete.map((object) => object.key)).toEqual(
      expect.arrayContaining([first.storageKey, second.storageKey]),
    );

    expect(await deleteManyFromR2([first.storageKey])).toEqual([]);
    expect(await listStorageObjects()).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: second.storageKey })]),
    );
    expect((await listStorageObjects()).some((object) => object.key === first.storageKey)).toBe(
      false,
    );

    await deleteFromR2(second.storageKey);
    expect(await listStorageObjects()).toEqual([]);
  });

  it("rejects malformed media URLs and traversal keys", async () => {
    expect(storageKeyFromLocalPublicUrl("/media/user%20with%20space/image.png")).toBe(
      "user with space/image.png",
    );
    expect(storageKeyFromLocalPublicUrl("/media/%2e%2e/secret.png")).toBeNull();
    expect(storageKeyFromLocalPublicUrl("/media/%E0%A4%A/image.png")).toBeNull();
    expect(storageKeyFromLocalPublicUrl("/api/local-storage?key=secret.png")).toBeNull();
    expect(localStoragePublicUrl("user with space/image.png")).toBe(
      "/media/user%20with%20space/image.png",
    );
  });

  it("protects reads, writes, deletes, and listings from symlink escapes", async () => {
    const sentinel = join(outsideDirectory, "probe.png");
    writeFileSync(sentinel, ONE_PIXEL_PNG);
    symlinkSync(
      outsideDirectory,
      join(directory, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(getUploadObject("escape/probe.png")).rejects.toThrow("invalid storage key");
    await expect(writeLocalStorageObject("escape/new.png", ONE_PIXEL_PNG)).rejects.toThrow(
      "invalid storage key",
    );
    await expect(deleteLocalStorageObject("escape/probe.png")).rejects.toThrow(
      "invalid storage key",
    );
    expect((await listStorageObjects()).some((object) => object.key.startsWith("escape/"))).toBe(
      false,
    );
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(outsideDirectory, "new.png"))).toBe(false);
  });
});
