// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import { PassThrough, Readable } from "node:stream";
import * as safeHttp from "./studio/safe-http.server";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-s3")>(),
  S3Client: class { send = mocks.send; },
}));
import { getStoredImageObject, putToR2, putUserUpload } from "./r2.server";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

describe("abortable storage IO", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("STORAGE_DRIVER", "s3");
    vi.stubEnv("DISPOSABLE_TEST_DB_DRIVER", "");
    for (const key of ["STORAGE_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"]) vi.stubEnv(key, "test-only");
    vi.stubEnv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:1");
    vi.stubEnv("STORAGE_PUBLIC_BASE_URL", "https://storage.invalid");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("cancels the provider URL fetch through its underlying AbortSignal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(safeHttp, "safeHttpsRequest").mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const work = putToR2("user", "job", { url: "https://provider.example/private-url" }, controller.signal);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("passes cancellation to S3 uploads and refuses pre-aborted images", async () => {
    const controller = new AbortController();
    mocks.send.mockImplementation((_command, options) => new Promise((_resolve, reject) => {
      options?.abortSignal?.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true });
    }));
    const work = putToR2("user", "job", { b64_json: png }, controller.signal);
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.send.mock.calls[0]?.[1]?.abortSignal).toBe(controller.signal);
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    await expect(putToR2("user", "job", { b64_json: png }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("passes cancellation to reference-image reads", async () => {
    const controller = new AbortController();
    mocks.send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1]) } });
    await getStoredImageObject("reference.png", controller.signal);
    expect(mocks.send.mock.calls[0]?.[1]?.abortSignal).toBe(controller.signal);
  });

  it("refuses a real local HTTP image URL before connecting", async () => {
    const received = vi.fn();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.write(new Uint8Array([1]));
      received();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing local server port");
    const controller = new AbortController();
    try {
      const work = putToR2("user", "job", { url: `http://127.0.0.1:${address.port}/image.png` }, controller.signal);
      await expect(work).rejects.toThrow();
      expect(received).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("passes upload cancellation through to object storage", async () => {
    const controller = new AbortController();
    await putUserUpload({ userId: "owner", bytes: Buffer.from(png, "base64"), contentType: "image/png", ext: "png", signal: controller.signal });
    expect(mocks.send.mock.calls[0]?.[1]?.abortSignal).toBe(controller.signal);
  });

  it("caps S3 streams at 64MiB even without a content-length header", async () => {
    const chunk = Buffer.alloc(1024 * 1024);
    const body = Object.assign(Readable.from((function* () { for (let i = 0; i < 65; i++) yield chunk; })()), {
      transformToByteArray: vi.fn(async () => new Uint8Array([1])),
    });
    mocks.send.mockResolvedValue({ Body: body });
    await expect(getStoredImageObject("oversized.png")).rejects.toThrow(/too large/i);
    expect(body.transformToByteArray).not.toHaveBeenCalled();
    expect(body.destroyed).toBe(true);
  });

  it("destroys an S3 response stream after headers and removes its abort listener", async () => {
    const controller = new AbortController();
    let rejectBody!: (error: Error) => void;
    const destroy = vi.fn((error: Error) => rejectBody(error));
    mocks.send.mockResolvedValue({ Body: {
      destroy,
      transformToByteArray: () => new Promise<Uint8Array>((_resolve, reject) => { rejectBody = reject; }),
    } });
    const work = getStoredImageObject("reference.png", controller.signal);
    await vi.waitFor(() => expect(getEventListeners(controller.signal, "abort")).toHaveLength(1));
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(destroy).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("closes an already-aborted late S3 body without emitting an unhandled stream error", async () => {
    const controller = new AbortController();
    const error = vi.fn();
    const body = Object.assign(new PassThrough(), { transformToByteArray: vi.fn() });
    body.on("error", error);
    mocks.send.mockImplementation(async () => { controller.abort(); return { Body: body }; });
    await expect(getStoredImageObject("reference.png", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(body.destroyed).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
