// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { submitGeneration, uploadReference, validateReferenceImage } from "./api";
import type { StudioGenerateRequest } from "../../contracts/studio";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("anonymous studio requests", () => {
  it("reuses the provided id on manual network retry and never automatically resubmits", async () => {
    const bodies: StudioGenerateRequest[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) throw new TypeError("network lost");
      return Response.json({ generationId: bodies[1].generationId, status: "queued", conversationId: "conversation", deadlineAt: "date" }, { status: 202 });
    });
    const request: StudioGenerateRequest = { generationId: "f10c8523-20ee-45b0-8f2e-52a88dfdbe20", prompt: "a cat", size: "auto", baseUrl: "https://api.tangguo.xin/v1", apiKey: "fixture" };
    await expect(submitGeneration(request)).rejects.toThrow();
    expect(bodies).toHaveLength(1);
    await submitGeneration(request);
    expect(bodies[1].generationId).toBe(bodies[0].generationId);
  });
  it("rejects unsupported and oversized reference files before uploading", () => {
    expect(validateReferenceImage(new File(["image"], "x.gif", { type: "image/gif" }))).toMatch(/PNG/);
    expect(validateReferenceImage(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "x.png", { type: "image/png" }))).toMatch(/4 MiB/);
    expect(validateReferenceImage(new File(["image"], "x.webp", { type: "image/webp" }))).toBeNull();
  });
});

const UPLOAD_TIMEOUT_MS = 21 * 60 * 1_000;
const IMAGE_KEY = "uploads/owner/2026/10/reference.png";
function referenceFile(size = 65_553, type = "image/png") {
  return new File([Uint8Array.from({ length: size }, (_, index) => index % 251)], "original.png", { type });
}

describe("whole reference upload", () => {
  it("posts the full original 4 MiB file once as same-origin FormData", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json({ inputImageKey: IMAGE_KEY }));
    vi.stubGlobal("fetch", fetch);
    const original = referenceFile(4 * 1024 * 1024);

    await expect(uploadReference(original)).resolves.toBe(IMAGE_KEY);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/studio/uploads");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", signal: expect.any(AbortSignal) });
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect([...body.keys()]).toEqual(["file"]);
    const uploaded = body.get("file") as File;
    expect(uploaded.name).toBe(original.name);
    expect(uploaded.type).toBe(original.type);
    expect(uploaded.size).toBe(original.size);
    expect(Buffer.from(await uploaded.arrayBuffer()).equals(Buffer.from(await original.arrayBuffer()))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts supported %s files", async (type) => {
    const fetch = vi.fn(async () => Response.json({ inputImageKey: IMAGE_KEY }));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile(20, type))).resolves.toBe(IMAGE_KEY);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects empty, unsupported and oversized files before making any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile(0))).rejects.toThrow("为空");
    await expect(uploadReference(referenceFile(20, "image/gif"))).rejects.toThrow("PNG");
    await expect(uploadReference(referenceFile(4 * 1024 * 1024 + 1))).rejects.toThrow("4 MiB");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a network failure immediately without retrying or falling back", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new TypeError("connection lost"); });
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 408, 429, 500, 502, 503, 504])("returns HTTP %s immediately without reading a stalled error body or retrying", async (status) => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(new ReadableStream(), { status, headers: { "Retry-After": "1" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile())).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts a new complete upload only when explicitly called again after a failure", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(Response.json({ inputImageKey: IMAGE_KEY }));
    vi.stubGlobal("fetch", fetch);
    const original = referenceFile();
    await expect(uploadReference(original)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(uploadReference(original)).resolves.toBe(IMAGE_KEY);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("/api/studio/uploads");
      expect((init.body as FormData).get("file")).toBe(original);
    }
  });

  it("keeps one request pending until the full 21-minute deadline then aborts without retry", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const pending = expect(uploadReference(referenceFile())).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the original deadline while reading a successful response body", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let finishHeaders!: (response: Response) => void;
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((resolve) => { finishHeaders = resolve; });
    });
    vi.stubGlobal("fetch", fetch);
    const pending = expect(uploadReference(referenceFile())).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1_000);
    finishHeaders(new Response(new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    } })));
    await vi.advanceTimersByTimeAsync(60_000 - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a complete response just before the deadline and clears its timer", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const pending = uploadReference(referenceFile());
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    finish(Response.json({ inputImageKey: IMAGE_KEY }));
    await expect(pending).resolves.toBe(IMAGE_KEY);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
    expect(signal.aborted).toBe(false);
  });

  it.each([null, {}, { inputImageKey: "" }, { inputImageKey: 1 }, { inputImageKey: "x".repeat(301) },
    { inputImageKey: "other/file.png" }, { inputImageKey: "uploads/../file.png" },
    { inputImageKey: "uploads//file.png" }, { inputImageKey: "uploads/owner/with space.png" }])("rejects malformed success receipt %j without another request", async (receipt) => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json(receipt));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a non-JSON successful response and clears its timer", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("not json"));
    vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(referenceFile())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
