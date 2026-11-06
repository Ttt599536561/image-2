// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), safeRequest: vi.fn() }));
vi.mock("./studio/safe-http.server", async (original) => ({
  ...await original<typeof import("./studio/safe-http.server")>(), safeHttpsRequest: mocks.safeRequest,
}));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(), S3Client: class { send = mocks.send; },
}));
import { getStoredImageObject, putToR2 } from "./r2.server";
import { contentTypeForStorageKey } from "./local-storage.server";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
const gifHeader = Buffer.from("47494638396101000100800000000000ffffff", "hex");
const gifFrame = Buffer.from("21f90400140000002c0000000001000100000202440100", "hex");
const animatedGif = Buffer.concat([gifHeader, gifFrame, gifFrame, Buffer.from([0x3b])]);
describe("provider image storage boundary", () => {
  it("uses the persisted GIF suffix when an S3 adapter omits MIME metadata", async () => {
    mocks.send.mockResolvedValue({ Body: { transformToByteArray: async () => animatedGif } });
    const result = await getStoredImageObject("owner/result.gif");
    expect(result.contentType).toBe("image/gif");
    expect(Buffer.from(result.bytes)).toEqual(animatedGif);
  });
  it("rejects GIF images with no global or per-frame palette", async () => {
    const header = Buffer.from("47494638396101000100000000", "hex");
    const bytes = Buffer.concat([header, gifFrame, gifFrame, Buffer.from([0x3b])]);
    await expect(putToR2("owner", "job", { b64_json: bytes.toString("base64") }, undefined, "gif")).rejects.toMatchObject({ failureCode: "invalid_response" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("preserves a complete animated GIF and serves the right MIME and dimensions", async () => {
    const result = await putToR2("owner", "job", { b64_json: animatedGif.toString("base64") }, undefined, "gif");
    expect(result).toMatchObject({ contentType: "image/gif", width: 1, height: 1, sizeBytes: animatedGif.length });
    expect(result.storageKey).toMatch(/\.gif$/);
    expect(mocks.send.mock.calls[0][0].input.Body).toEqual(animatedGif);
    expect(contentTypeForStorageKey(result.storageKey)).toBe("image/gif");
  });
  it("accepts GIF URLs by their bytes even when the provider claims PNG", async () => {
    mocks.safeRequest.mockResolvedValue({ status: 200, headers: { "content-type": "image/png" }, body: animatedGif });
    expect(await putToR2("owner", "job", { url: "https://provider.example/result.png" }, undefined, "gif")).toMatchObject({ contentType: "image/gif" });
  });
  it("retains the PNG original and its real extension when GIF was requested", async () => {
    const result = await putToR2("owner", "job", { b64_json: png.toString("base64") }, undefined, "gif");
    expect(result).toMatchObject({ contentType: "image/png", width: 1, height: 1, sizeBytes: png.length });
    expect(result.storageKey).toMatch(/\.png$/);
    expect(mocks.send.mock.calls[0][0].input.Body).toEqual(png);
  });
  it.each([Buffer.concat([gifHeader, gifFrame, Buffer.from([0x3b])]), animatedGif.subarray(0, -1)])("rejects single-frame or incomplete GIF results before persistence", async (bytes) => {
    await expect(putToR2("owner", "job", { b64_json: bytes.toString("base64") }, undefined, "gif")).rejects.toMatchObject({ failureCode: "invalid_response" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
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
      const result = await putToR2("owner", "job", { b64_json: bytes.toString("base64") }, undefined, "gif");
      expect(result.contentType).toBe(mime);
      expect(result.storageKey).toMatch(new RegExp(`\\.${extension}$`));
    }
  });
});
