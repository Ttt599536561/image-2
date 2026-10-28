// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), safeRequest: vi.fn() }));
vi.mock("./studio/safe-http.server", async (original) => ({
  ...await original<typeof import("./studio/safe-http.server")>(), safeHttpsRequest: mocks.safeRequest,
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(), S3Client: class { send = mocks.send; },
}));
import { putToR2 } from "./r2.server";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
describe("provider image storage boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("DISPOSABLE_TEST_DB_DRIVER", "");
    for (const name of ["STORAGE_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"]) vi.stubEnv(name, "fixture");
    vi.stubEnv("STORAGE_S3_ENDPOINT", "https://storage.example");
    vi.stubEnv("STORAGE_PUBLIC_BASE_URL", "https://storage.example/images");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("downloads through pinned HTTPS with a size budget, deadline and no credentials", async () => {
    mocks.safeRequest.mockResolvedValue({ status: 200, headers: { "content-type": "text/html" }, body: png });
    const controller = new AbortController();
    const result = await putToR2("owner", "job", { url: "https://provider.example/image?signature=secret" }, controller.signal);
    expect(mocks.safeRequest).toHaveBeenCalledWith("https://provider.example/image?signature=secret", {
      signal: controller.signal, maxResponseBytes: 32 * 1024 * 1024, deadlineAtMs: expect.any(Number),
    });
    expect(result.contentType).toBe("image/png");
    expect(result.width).toBe(1);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each([Buffer.from("<html>private provider error</html>"), Buffer.from("GIF89a"), Buffer.from([137, 80, 78, 71, 1, 2, 3, 4])])("rejects untrusted image bytes regardless of declared content type", async (body) => {
    mocks.safeRequest.mockResolvedValue({ status: 200, headers: { "content-type": "image/png" }, body });
    await expect(putToR2("owner", "job", { url: "https://provider.example/image" })).rejects.toThrow(/image/i);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized base64 before persistence", async () => {
    await expect(putToR2("owner", "job", { b64_json: "invalid base64 !" })).rejects.toThrow();
    await expect(putToR2("owner", "job", { b64_json: "A".repeat(Math.ceil((32 * 1024 * 1024 + 1) / 3) * 4) })).rejects.toThrow(/large/i);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("accepts JPEG and WebP and uses their actual MIME type and extension", async () => {
    for (const [bytes, mime, extension] of [
      [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]), "image/jpeg", "jpg"],
      [Buffer.concat([Buffer.from("RIFF"), Buffer.from([12, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(4)]), "image/webp", "webp"],
    ] as const) {
      const result = await putToR2("owner", "job", { b64_json: bytes.toString("base64") });
      expect(result.contentType).toBe(mime);
      expect(result.storageKey).toMatch(new RegExp(`\\.${extension}$`));
    }
  });
});
