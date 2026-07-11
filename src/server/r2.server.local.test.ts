// @vitest-environment node
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loader as loadLocalStorage } from "../../app/routes/api.local-storage";
import {
  deleteLocalStorageObject,
  writeLocalStorageObject,
} from "./local-storage.server";
import { deleteFromR2, getUploadObject, putToR2, putUserUpload } from "./r2.server";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("disposable local object storage", () => {
  let directory = "";
  let outsideDirectory = "";
  const originalDriver = process.env.DISPOSABLE_TEST_DB_DRIVER;
  const originalRoot = process.env.LOCAL_TEST_STORAGE_ROOT;
  const originalAuthUrl = process.env.BETTER_AUTH_URL;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "key-mode-local-storage-"));
    outsideDirectory = mkdtempSync(join(tmpdir(), "key-mode-outside-storage-"));
    process.env.DISPOSABLE_TEST_DB_DRIVER = "pg";
    process.env.LOCAL_TEST_STORAGE_ROOT = directory;
    process.env.BETTER_AUTH_URL = "http://localhost:8888";
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
    if (originalDriver === undefined) delete process.env.DISPOSABLE_TEST_DB_DRIVER;
    else process.env.DISPOSABLE_TEST_DB_DRIVER = originalDriver;
    if (originalRoot === undefined) delete process.env.LOCAL_TEST_STORAGE_ROOT;
    else process.env.LOCAL_TEST_STORAGE_ROOT = originalRoot;
    if (originalAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalAuthUrl;
  });

  it("stores generated images behind a local public URL", async () => {
    const result = await putToR2("user-id", "generation-id", {
      b64_json: ONE_PIXEL_PNG.toString("base64"),
    });

    expect(result.publicUrl).toContain("/api/local-storage?key=");
    expect(result.sizeBytes).toBe(ONE_PIXEL_PNG.byteLength);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);

    const response = await loadLocalStorage({
      request: new Request(result.publicUrl),
      params: {},
      context: {},
    } as Parameters<typeof loadLocalStorage>[0]);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(ONE_PIXEL_PNG);
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

    const response = await loadLocalStorage({
      request: new Request("http://localhost:8888/api/local-storage?key=escape%2Fprobe.png"),
      params: {},
      context: {},
    } as Parameters<typeof loadLocalStorage>[0]);
    expect(response.status).toBe(404);
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
