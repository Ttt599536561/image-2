// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), enqueue: vi.fn(), sql: vi.fn(), statuses: vi.fn(), rate: vi.fn(), store: vi.fn(), upload: vi.fn(), subscribe: vi.fn() }));
vi.mock("./session.server", () => ({ requireStudioSession: mock.auth, getOrCreateStudioSession: mock.session }));
vi.mock("./limits.server", () => ({ consumeStudioRate: mock.rate }));
vi.mock("./safe-http.server", () => ({ normalizeStudioBaseUrl: (s: string) => s }));
vi.mock("../generation/enqueue", () => ({ enqueueGeneration: mock.enqueue }));
vi.mock("../../db/db.server", () => ({ getSql: () => mock.sql }));
vi.mock("../../db/db-driver.server", () => ({ usesPgDriver: () => true }));
vi.mock("../generation/status.server", async (actual) => ({ ...await actual<object>(), loadGenerationStatuses: mock.statuses }));
vi.mock("../generation/notifications.server", () => ({ subscribeGenerationChanges: mock.subscribe }));
vi.mock("../r2.server", () => ({ getStoredImageObject: mock.store, putUserUpload: mock.upload }));
import { studioEventsLoader, studioGenerateAction, studioImageLoader, studioSessionLoader, studioStatusLoader, studioUploadsAction } from "./api.server";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const input = { baseUrl: "https://api.tangguo.xin/v1", apiKey: "private-key", prompt: "tree", size: "1024x1024", generationId: id };
const req = (body: unknown) => new Request("https://studio.example/api/studio/generate", { method: "POST", headers: { origin: "https://studio.example", "content-type": "application/json" }, body: JSON.stringify(body) });
function useBodyDeadlineClock(): void {
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout does not use the fake timer clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
}
function delayedBodyRequest(path: string, contentType: string, bytes: Uint8Array, delayMs: number) {
  let timer: ReturnType<typeof setTimeout>;
  const cancelled = vi.fn(() => clearTimeout(timer));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const split = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, split));
      timer = setTimeout(() => { controller.enqueue(bytes.slice(split)); controller.close(); }, delayMs);
    },
    cancel: cancelled,
  });
  const request = new Request(`https://studio.example/api/studio/${path}`, {
    method: "POST", headers: { origin: "https://studio.example", "content-type": contentType, "content-length": String(bytes.length) },
    body, duplex: "half",
  } as RequestInit);
  return { request, cancelled };
}
async function referenceMultipart() {
  const image = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=", "base64"));
  const form = new FormData(); form.set("file", new File([image], "reference.png", { type: "image/png" }));
  const encoded = new Response(form);
  return { image, bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type")! };
}

describe("anonymous API", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });
  beforeEach(() => {
    mock.auth.mockReset().mockResolvedValue({ userId: "owner", maxConcurrency: 10 });
    mock.session.mockReset().mockResolvedValue({ userId: "owner", cookie: "studio_session=opaque; HttpOnly" });
    mock.rate.mockReset().mockResolvedValue(undefined); mock.sql.mockReset().mockResolvedValue([]);
    mock.enqueue.mockReset().mockResolvedValue({ generationId: id, conversationId: other, credentialMode: "custom", deadlineAt: "2026-10-28T12:00:00Z" });
    mock.statuses.mockReset().mockResolvedValue([]); mock.store.mockReset(); mock.upload.mockReset();
  });
  it("keeps SSE snapshots and reconnect recovery scoped to the browser owner", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn(); mock.subscribe.mockReset().mockReturnValue(unsubscribe);
    mock.statuses.mockResolvedValue([{ generationId: id, status: "queued", credentialMode: "custom", deadlineAt: "2026-10-28T12:00:00Z" }]);
    const response = await studioEventsLoader(new Request(`https://studio.example/api/studio/events?ids=${id},${other}`));
    const reader = response.body!.getReader();
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    await flush();
    const text = new TextDecoder().decode((await reader.read()).value) + new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"missingIds":["${other}"]`); expect(text).not.toContain("credentialMode");
    const [change, ready] = mock.subscribe.mock.calls[0];
    change({ userId: "not-owner", generationId: id }); await flush(); expect(mock.statuses).toHaveBeenCalledTimes(1);
    ready(); await flush(); expect(mock.statuses).toHaveBeenCalledTimes(2);
    change({ userId: "owner", generationId: id }); await flush(); expect(mock.statuses).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000); expect(mock.statuses).toHaveBeenCalledTimes(4);
    await reader.cancel(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("exposes only defaults and limits in the session payload", async () => {
    const res = await studioSessionLoader(new Request("https://studio.example/api/studio/session"));
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const data = await res.json(); expect(data.ok).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/owner|token|credits/);
  });
  it("forces custom with sealed base URL, rejects injected system/owner fields", async () => {
    const response = await studioGenerateAction(req(input));
    expect(response.status).toBe(202);
    expect(mock.enqueue).toHaveBeenCalledWith({ user: { id: "owner", maxConcurrency: 10 }, input: expect.objectContaining({ credentialMode: "custom", customApiKey: input.apiKey, customBaseUrl: input.baseUrl }) });
    const serialized = JSON.stringify(await response.json()); expect(serialized).not.toMatch(/private-key|credentialMode/);
    for (const field of [{ credentialMode: "system" }, { userId: other }]) expect((await studioGenerateAction(req({ ...input, ...field }))).status).toBe(400);
    expect(mock.enqueue).toHaveBeenCalledOnce();
  });
  it("uses the fixed endpoint when omitted and freezes the selected model with four ordered references", async () => {
    const inputImageKeys = [1, 2, 3, 4].map((n) => `uploads/owner/2026/10/00000000-0000-4000-8000-00000000000${n}.png`);
    expect((await studioGenerateAction(req({ ...input, baseUrl: undefined, model: "gpt-image-2.5-sunburst", inputImageKeys }))).status).toBe(202);
    expect(mock.enqueue).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ model: "gpt-image-2.5-sunburst", inputImageKeys, customBaseUrl: input.baseUrl }) }));
  });
  it("validates every reference owner and rejects substituted endpoints before enqueue", async () => {
    const own = `uploads/owner/2026/10/${id}.png`;
    for (const patch of [
      { baseUrl: "https://attacker.example/v1" },
      { inputImageKeys: [own, own, own, `uploads/other/2026/10/${other}.png`] },
      { inputImageKeys: [own, own, own, "uploads/owner/../../secret"] },
      { inputImageKeys: [own, own, own, own, own] },
      { inputImageKeys: [own], inputImageKey: own },
      { inputImageKeys: [own], sourceImageId: other },
    ]) expect((await studioGenerateAction(req({ ...input, ...patch }))).status).toBe(400);
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before loading owner or consuming a body", async () => {
    const response = await studioGenerateAction(new Request("https://studio.example/api/studio/generate", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify(input) }));
    expect(response.status).toBe(403); expect(mock.auth).not.toHaveBeenCalled(); expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("applies IP admission before looking up an attacker-supplied session cookie", async () => {
    mock.rate.mockRejectedValueOnce(new Response(null, { status: 429 }));
    const res = await studioStatusLoader(new Request(`https://studio.example/api/studio/status?ids=${id}`));
    expect(res.status).toBe(429); expect(mock.auth).not.toHaveBeenCalled();
  });
  it("maps owned status to private URLs without financial/source details", async () => {
    mock.statuses.mockResolvedValue([{ generationId: id, status: "succeeded", credentialMode: "custom", creditsChargedMp: 0, deadlineAt: "2026-10-28T12:00:00Z", durationMs: 12, sourceImageId: "sensitive", sourceImage: { publicUrl: "https://public.example/source" }, image: { id: other, publicUrl: "https://public.example/image", width: 1, height: 1 } }]);
    const res = await studioStatusLoader(new Request(`https://studio.example/api/studio/status?ids=${id},${other}`));
    const data = await res.json();
    expect(data.items[0].image.url).toBe(`/api/studio/images/${other}`);
    expect(data.missingIds).toEqual([other]);
    expect(JSON.stringify(data)).not.toMatch(/credits|credentialMode|source|public.example/);
    expect(mock.statuses).toHaveBeenCalledWith("owner", [id, other]);
  });
  it("does not read an unowned image object", async () => {
    expect((await studioImageLoader(new Request("https://studio.example"), id)).status).toBe(404);
    expect(mock.store).not.toHaveBeenCalled();
    mock.sql.mockResolvedValue([{ storage_key: "owner/object.png" }]);
    mock.store.mockResolvedValue({ bytes: new Uint8Array([1, 2]), contentType: "image/png", filename: "x.png" });
    const response = await studioImageLoader(new Request("https://studio.example"), id);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(mock.sql.mock.calls.at(-1)![0].join("?")).toContain("user_id=");
    expect(mock.sql.mock.calls.at(-1)).toContain("owner");
  });
  it("accepts a multipart reference upload taking longer than 15 seconds", async () => {
    const multipart = await referenceMultipart();
    useBodyDeadlineClock();
    const { request, cancelled } = delayedBodyRequest("uploads", multipart.contentType, multipart.bytes, 20_000);
    const storageKey = `uploads/owner/2026/10/${id}.png`;
    mock.upload.mockResolvedValue({ storageKey });
    const responsePromise = studioUploadsAction(request);
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inputImageKey: storageKey });
    expect(mock.upload).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", bytes: multipart.image, contentType: "image/png" }));
    expect(cancelled).not.toHaveBeenCalled();
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("cancels an unfinished multipart upload at 120 seconds without storing it", async () => {
    const multipart = await referenceMultipart();
    useBodyDeadlineClock();
    const { request, cancelled } = delayedBodyRequest("uploads", multipart.contentType, multipart.bytes, 130_000);
    let settled = false;
    const responsePromise = studioUploadsAction(request).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);
    expect(cancelled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await responsePromise).status).toBe(408);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("keeps the generation JSON body deadline at 15 seconds", async () => {
    useBodyDeadlineClock();
    const { request, cancelled } = delayedBodyRequest("generate", "application/json", new TextEncoder().encode(JSON.stringify(input)), 16_000);
    let settled = false;
    const responsePromise = studioGenerateAction(request).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await responsePromise).status).toBe(408);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("rejects oversize multipart body and spoofed image content", async () => {
    const form = new FormData(); form.set("file", new File(["plain text"], "x.png", { type: "image/png" }));
    const response = await studioUploadsAction(new Request("https://studio.example/api/studio/uploads", { method: "POST", headers: { origin: "https://studio.example" }, body: form }));
    expect(response.status).toBe(400); expect(mock.upload).not.toHaveBeenCalled();
    const huge = new Request("https://studio.example/api/studio/uploads", { method: "POST", headers: { origin: "https://studio.example", "content-type": "multipart/form-data; boundary=x", "content-length": "9000000" }, body: "x" });
    expect((await studioUploadsAction(huge)).status).toBe(413);
  });
});
