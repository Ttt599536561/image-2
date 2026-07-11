// @vitest-environment node
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorBody } from "../../src/contracts/error";
import { writeLocalStorageObject } from "../../src/server/local-storage.server";
import routes from "../routes";
import { loader } from "./media.$";

const originalStorageDriver = process.env.STORAGE_DRIVER;
const originalDisposableDriver = process.env.DISPOSABLE_TEST_DB_DRIVER;
const originalStorageRoot = process.env.LOCAL_STORAGE_ROOT;
const FILE_BYTES = new Uint8Array([0, 1, 2, 127, 255]);

let storageRoot = "";

beforeEach(() => {
  storageRoot = mkdtempSync(join(tmpdir(), "media-route-storage-"));
  process.env.STORAGE_DRIVER = "local";
  delete process.env.DISPOSABLE_TEST_DB_DRIVER;
  process.env.LOCAL_STORAGE_ROOT = storageRoot;
});

afterEach(() => {
  rmSync(storageRoot, { recursive: true, force: true });
  if (originalStorageDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = originalStorageDriver;
  if (originalDisposableDriver === undefined) delete process.env.DISPOSABLE_TEST_DB_DRIVER;
  else process.env.DISPOSABLE_TEST_DB_DRIVER = originalDisposableDriver;
  if (originalStorageRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = originalStorageRoot;
});

async function load(path: string): Promise<Response> {
  return loader({
    request: new Request(`https://images.example${path}`),
    params: { "*": "../../untrusted-wildcard" },
    context: {},
  } as Parameters<typeof loader>[0]);
}

async function expectNotFound(path: string): Promise<void> {
  const response = await load(path);
  expect(response.status).toBe(404);
  const body = ErrorBody.parse(await response.json());
  expect(body).toEqual({
    error: {
      code: "NOT_FOUND",
      message: "Resource not found",
    },
  });
  expect(JSON.stringify(body)).not.toContain(storageRoot);
}

describe("self-hosted media route", () => {
  it("registers only the media wildcard", () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "media/*", file: "routes/media.$.ts" }),
      ]),
    );
    expect(routes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "api/local-storage",
          file: "routes/api.local-storage.ts",
        }),
      ]),
    );
  });

  it("exports a loader", async () => {
    const routeModule = await import("./media.$").catch(() => null);
    expect(routeModule?.loader).toBeTypeOf("function");
  });

  it("serves exact bytes for an encoded nested filename with immutable headers", async () => {
    await writeLocalStorageObject("users/a file #1.webp", FILE_BYTES);

    const response = await load("/media/users/a%20file%20%231.webp");

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FILE_BYTES);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns a safe 404 for a missing object", async () => {
    await expectNotFound("/media/users/missing.png");
  });

  it("returns a safe 404 when the local driver is disabled", async () => {
    await writeLocalStorageObject("users/present.png", FILE_BYTES);
    delete process.env.STORAGE_DRIVER;
    await expectNotFound("/media/users/present.png");
  });

  it.each([
    "/media/%2e%2e/secret.png",
    "/media/users%2Fsecret.png",
    "/media/%E0%A4%A/image.png",
  ])("returns a safe 404 for invalid media path %s", async (path) => {
    await expectNotFound(path);
  });

  it("returns a safe 404 when a storage path escapes through a symlink", async () => {
    const outside = mkdtempSync(join(tmpdir(), "media-route-outside-"));
    try {
      writeFileSync(join(outside, "probe.png"), FILE_BYTES);
      symlinkSync(
        outside,
        join(storageRoot, "escape"),
        process.platform === "win32" ? "junction" : "dir",
      );

      await expectNotFound("/media/escape/probe.png");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
