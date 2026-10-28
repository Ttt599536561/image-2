// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ owner: vi.fn(), rate: vi.fn(), create: vi.fn(), write: vi.fn(), complete: vi.fn() }));
vi.mock("./session.server", () => ({ requireStudioSession: mock.owner }));
vi.mock("./limits.server", () => ({ consumeStudioRate: mock.rate }));
vi.mock("./resumable-upload.server", () => ({ createStudioUpload: mock.create, writeStudioUploadChunk: mock.write, completeStudioUpload: mock.complete }));
import { studioUploadCreateAction, studioUploadChunkAction, studioUploadCompleteAction } from "./resumable-api.server";
const id = "00000000-0000-4000-8000-000000000001";
const metadata = { uploadId: id, size: 4, mime: "image/png", sha256: "0".repeat(64) };
const request = (method: string, body?: BodyInit, type = "application/json", origin = "https://studio.example") => new Request("https://studio.example/api/studio/uploads/resumable", { method, headers: { origin, "content-type": type, "x-studio-client-ip": "203.0.113.1" }, body });
beforeEach(() => { vi.resetAllMocks(); mock.owner.mockResolvedValue({ userId: "owner" }); mock.create.mockResolvedValue({ uploadId: id }); mock.write.mockResolvedValue({ nextIndex: 1 }); mock.complete.mockResolvedValue({ inputImageKey: "uploads/owner/key.png" }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("binds strict metadata to the cookie owner and returns only the resumable result", async () => {
  const response = await studioUploadCreateAction(request("POST", JSON.stringify(metadata)));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.create).toHaveBeenCalledWith("owner", "203.0.113.1", metadata);
  expect((await studioUploadCreateAction(request("POST", JSON.stringify({ ...metadata, apiKey: "secret" })))).status).toBe(400);
  expect((await studioUploadCreateAction(request("POST", JSON.stringify({ ...metadata, ownerId: "foreign" })))).status).toBe(400);
  expect(mock.create).toHaveBeenCalledOnce();
});
it("guards origin, cookie and HTTP method on every route including raw PUT", async () => {
  for (const origin of ["https://evil.example", "null"]) {
    expect((await studioUploadCreateAction(request("POST", "{}", "application/json", origin))).status).toBe(403);
    expect((await studioUploadChunkAction(request("PUT", new Uint8Array([1]), "application/octet-stream", origin), id, "0")).status).toBe(403);
    expect((await studioUploadCompleteAction(request("POST", undefined, "application/json", origin), id)).status).toBe(403);
  }
  mock.owner.mockRejectedValue(new Response(null, { status: 401 }));
  expect((await studioUploadChunkAction(request("PUT", new Uint8Array([1]), "application/octet-stream"), id, "0")).status).toBe(401);
  expect((await studioUploadCompleteAction(request("POST"), id)).status).toBe(401);
  expect((await studioUploadCreateAction(request("GET"))).status).toBe(405);
  expect(mock.write).not.toHaveBeenCalled(); expect(mock.complete).not.toHaveBeenCalled();
});
it("bounds chunks, indexes and content type before storage; uses a separate chunk rate scope", async () => {
  const response = await studioUploadChunkAction(request("PUT", new Uint8Array([1, 2]), "application/octet-stream"), id, "0");
  expect(await response.json()).toEqual({ nextIndex: 1 });
  expect(mock.write).toHaveBeenCalledWith("owner", id, 0, new Uint8Array([1, 2]));
  expect(mock.rate).toHaveBeenCalledWith(expect.any(Request), "upload-chunk", "owner", { ownerOnly: true, uploadId: id });
  expect((await studioUploadChunkAction(request("PUT", new Uint8Array(65537), "application/octet-stream"), id, "0")).status).toBe(413);
  expect((await studioUploadChunkAction(request("PUT", "{}"), id, "0")).status).toBe(415);
  for (const index of ["64", "-1", "0.5", "01"]) expect((await studioUploadChunkAction(request("PUT", new Uint8Array([1]), "application/octet-stream"), id, index)).status).toBe(400);
  expect(mock.write).toHaveBeenCalledOnce();
});
it("rejects completion payloads and preserves typed failures without leaking internal errors", async () => {
  expect((await studioUploadCompleteAction(request("POST", JSON.stringify({ apiKey: "secret" })), id)).status).toBe(413);
  expect(mock.complete).not.toHaveBeenCalled();
  mock.complete.mockRejectedValueOnce(new Response(null, { status: 410 }));
  expect((await studioUploadCompleteAction(request("POST"), id)).status).toBe(410);
  mock.complete.mockRejectedValueOnce(new Error("sensitive storage detail"));
  const failed = await studioUploadCompleteAction(request("POST"), id);
  expect(failed.status).toBe(500); expect(await failed.text()).not.toContain("sensitive");
});
it("ends a stalled chunk at the fifteen second body deadline", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
  const stalled = new Request("https://studio.example/api/studio/uploads/resumable", { method: "PUT", headers: { origin: "https://studio.example", "content-type": "application/octet-stream" }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }), duplex: "half" } as RequestInit);
  const result = studioUploadChunkAction(stalled, id, "0");
  await vi.advanceTimersByTimeAsync(15_001);
  expect((await result).status).toBe(408); expect(mock.write).not.toHaveBeenCalled();
});
