// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadReference } from "./api";

const BASE = "/api/studio/uploads/resumable";
const CHUNK = 65_536;
const KEY = "uploads/owner/2026/10/reference.png";
type Call = { url: string; init: RequestInit; body?: Record<string, unknown> };
type Session = { nextIndex: number; chunks: Uint8Array[]; complete: boolean };
function server(hook?: (call: Call, response: Response, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const sessions = new Map<string, Session>();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call: Call = { url, init, ...(url === BASE ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(call);
    let response: Response;
    if (url === BASE) {
      const id = String(call.body!.uploadId);
      const session = sessions.get(id) ?? { nextIndex: 0, chunks: [], complete: false };
      sessions.set(id, session);
      response = Response.json({ uploadId: id, chunkSize: CHUNK, nextIndex: session.nextIndex, expiresAt: new Date(Date.now() + 600_000).toISOString(), ...(session.complete ? { inputImageKey: KEY } : {}) });
    } else {
      const [, id, index] = url.slice(BASE.length).split("/");
      const session = sessions.get(id);
      if (!session) throw new Error("Unknown session");
      if (index === "complete") {
        session.complete = true;
        response = Response.json({ inputImageKey: KEY });
      } else {
        session.chunks[Number(index)] = new Uint8Array(await (init.body as Blob).arrayBuffer());
        session.nextIndex = Math.max(session.nextIndex, Number(index) + 1);
        response = Response.json({ nextIndex: session.nextIndex });
      }
    }
    return hook ? hook(call, response, calls) : response;
  });
  return { calls, sessions };
}
function file(size = CHUNK * 2 + 17) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
  return new File([bytes], "original.png", { type: "image/png" });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("resumable reference upload", () => {
  it("hashes original bytes and serially transfers 64 KiB slices without compression or credentials in payloads", async () => {
    const original = file(); const { calls, sessions } = server();
    await expect(uploadReference(original)).resolves.toBe(KEY);
    expect(calls.map((call) => call.init.method)).toEqual(["POST", "PUT", "PUT", "PUT", "POST"]);
    expect(calls[0].body).toEqual({ uploadId: expect.any(String), size: original.size, mime: original.type, sha256: createHash("sha256").update(new Uint8Array(await original.arrayBuffer())).digest("hex") });
    expect(calls.every((call) => call.init.credentials === "same-origin")).toBe(true);
    expect(calls.filter((call) => call.init.method === "PUT").map((call) => (call.init.body as Blob).size)).toEqual([CHUNK, CHUNK, 17]);
    expect(calls[1].init.headers).toEqual({ "Content-Type": "application/octet-stream" });
    const bytes = Buffer.concat([...sessions.values()][0].chunks);
    expect(bytes.equals(Buffer.from(await original.arrayBuffer()))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/apiKey|baseUrl|ownerId/);
  });

  it("preserves a full 4 MiB file across exactly 64 chunks", async () => {
    const original = file(4 * 1024 * 1024); const { calls, sessions } = server();
    await expect(uploadReference(original)).resolves.toBe(KEY);
    expect(calls.filter((call) => call.init.method === "PUT")).toHaveLength(64);
    expect(createHash("sha256").update(Buffer.concat([...sessions.values()][0].chunks)).digest("hex")).toBe(calls[0].body!.sha256);
  });

  it("shares an in-progress upload for the same File without duplicating sessions or bytes", async () => {
    const original = file(20); const { calls } = server();
    await expect(Promise.all([uploadReference(original), uploadReference(original)])).resolves.toEqual([KEY, KEY]);
    expect(calls).toHaveLength(3);
  });

  it.each(["create", "chunk", "complete"])("recovers a lost %s response using the same id and bytes", async (phase) => {
    let lost = false;
    const { calls } = server((call, response) => {
      const matches = phase === "create" ? call.url === BASE : phase === "chunk" ? call.init.method === "PUT" : call.url.endsWith("/complete");
      if (matches && !lost) { lost = true; throw new TypeError("connection lost"); }
      return response;
    });
    await expect(uploadReference(file(20))).resolves.toBe(KEY);
    const repeats = calls.filter((call) => phase === "create" ? call.url === BASE : phase === "chunk" ? call.init.method === "PUT" : call.url.endsWith("/complete"));
    expect(repeats).toHaveLength(2);
    expect(repeats[0].url).toBe(repeats[1].url);
    if (phase === "create") expect(repeats[0].body).toEqual(repeats[1].body);
    if (phase === "chunk") expect(await (repeats[0].init.body as Blob).arrayBuffer()).toEqual(await (repeats[1].init.body as Blob).arrayBuffer());
  });

  it("stops after three attempts and resumes from the server nextIndex on manual retry", async () => {
    let fail = true;
    const { calls } = server((call, response) => {
      if (fail && call.init.method === "PUT") throw new TypeError("response lost");
      return response;
    });
    const original = file();
    await expect(uploadReference(original)).rejects.toThrow();
    expect(calls.filter((call) => call.init.method === "PUT")).toHaveLength(3);
    fail = false;
    await expect(uploadReference(original)).resolves.toBe(KEY);
    const creates = calls.filter((call) => call.url === BASE);
    expect(creates[0].body).toEqual(creates[1].body);
    expect(calls.filter((call) => call.init.method === "PUT").map((call) => call.url.split("/").at(-1))).toEqual(["0", "0", "0", "1", "2"]);
  });

  it("recovers an already completed upload receipt without sending bytes again", async () => {
    let fail = true;
    const { calls } = server((call, response) => {
      if (fail && call.url.endsWith("/complete")) throw new TypeError("response lost");
      return response;
    });
    const original = file(20);
    await expect(uploadReference(original)).rejects.toThrow();
    fail = false;
    await expect(uploadReference(original)).resolves.toBe(KEY);
    expect(calls.filter((call) => call.init.method === "PUT")).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/complete"))).toHaveLength(3);
  });

  it.each([408, 500, 502, 503, 504])("retries transient HTTP %s at most three times", async (status) => {
    const { calls } = server(() => Response.json({ error: "private error details" }, { status }));
    await expect(uploadReference(file(20))).rejects.toThrow("任务暂未完成，请重试此任务。");
    expect(calls).toHaveLength(3);
  });

  it.each([400, 401, 403, 404, 409, 413, 422, 501])("does not retry HTTP %s", async (status) => {
    const { calls } = server(() => Response.json({ error: "private error details" }, { status }));
    await expect(uploadReference(file(20))).rejects.toThrow("任务暂未完成，请重试此任务。");
    expect(calls).toHaveLength(1);
  });

  it.each([429, 503])("honors HTTP %s Retry-After when bounded and refuses an excessively long wait", async (status) => {
    vi.useFakeTimers();
    const { calls } = server((_, response, calls) => calls.length === 1 ? new Response(null, { status, headers: { "Retry-After": "2" } }) : response);
    const pending = uploadReference(file(20));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1_900);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(KEY);
    const long = server(() => new Response(null, { status, headers: { "Retry-After": "600" } }));
    await expect(uploadReference(file(20))).rejects.toThrow();
    expect(long.calls).toHaveLength(1);
  });

  it("aborts a stalled chunk at 20 seconds and stops after three deadlines", async () => {
    vi.useFakeTimers(); let attempts = 0;
    server((call, response) => {
      if (call.init.method !== "PUT") return response;
      attempts++;
      return new Promise<Response>((_, reject) => call.init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const pending = expect(uploadReference(file(20))).rejects.toThrow();
    await vi.waitFor(() => expect(attempts).toBe(1));
    await vi.advanceTimersByTimeAsync(19_900); expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await pending; expect(attempts).toBe(3);
  });

  it("allows 40 seconds for completion and applies its deadline to the response body", async () => {
    vi.useFakeTimers(); let attempts = 0; let signal: AbortSignal | null | undefined;
    server((call, response) => {
      if (!call.url.endsWith("/complete")) return response;
      attempts++; signal = call.init.signal;
      if (attempts > 1) return response;
      return new Response(new ReadableStream({ start(controller) {
        signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } }));
    });
    const pending = uploadReference(file(20));
    await vi.waitFor(() => expect(attempts).toBe(1));
    const firstSignal = signal!;
    await vi.advanceTimersByTimeAsync(39_900);
    expect(firstSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(KEY);
    expect(firstSignal.aborted).toBe(true);
    expect(attempts).toBe(2);
  });

  it("bounds a server that keeps returning 429 even when Retry-After is zero", async () => {
    const { calls } = server(() => new Response(null, { status: 429, headers: { "Retry-After": "0" } }));
    await expect(uploadReference(file(20))).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  it("accepts a server-valid session when the browser clock is one hour ahead", async () => {
    const serverExpiresAt = new Date(Date.now() + 600_000).toISOString();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    const { calls } = server(async (call, response) => call.url === BASE
      ? Response.json({ ...await response.json(), expiresAt: serverExpiresAt })
      : response);
    await expect(uploadReference(file(20))).resolves.toBe(KEY);
    expect(calls.filter((call) => call.url === BASE)).toHaveLength(1);
    expect(calls.map((call) => call.init.method)).toEqual(["POST", "PUT", "POST"]);
  });

  it("restarts an expired session once with a fresh id and the same metadata", async () => {
    const { calls } = server((call, response, calls) => call.init.method === "PUT" && calls.filter((item) => item.url === BASE).length === 1 ? new Response(null, { status: 410 }) : response);
    await expect(uploadReference(file(20))).resolves.toBe(KEY);
    const creates = calls.filter((call) => call.url === BASE).map((call) => call.body!);
    expect(creates).toHaveLength(2);
    expect(creates[0].uploadId).not.toBe(creates[1].uploadId);
    expect({ ...creates[0], uploadId: null }).toEqual({ ...creates[1], uploadId: null });
  });

  it("bounds repeated expired sessions", async () => {
    const { calls } = server(() => new Response(null, { status: 410 }));
    await expect(uploadReference(file(20))).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });

  it.each([{ chunkSize: 0 }, { chunkSize: 131_072 }, { nextIndex: -1 }, { nextIndex: 2 }, { nextIndex: 0.5 }, { uploadId: "different" }, { expiresAt: "invalid" }, { inputImageKey: "" }, { inputImageKey: 1 }, { inputImageKey: "uploads/../bad" }])("rejects malformed create response %j before any chunks", async (override) => {
    const { calls } = server(async (_, response) => Response.json({ ...await response.json(), ...override }));
    await expect(uploadReference(file(20))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it.each([0, -1, 2, 0.5, "1", null])("rejects nonadvancing or invalid chunk nextIndex %j", async (nextIndex) => {
    const { calls } = server((call, response) => call.init.method === "PUT" ? Response.json({ nextIndex }) : response);
    await expect(uploadReference(file(20))).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });

  it.each([{}, { inputImageKey: "" }, { inputImageKey: false }, { inputImageKey: "x".repeat(301) }])("rejects invalid completion receipt %j", async (body) => {
    server((call, response) => call.url.endsWith("/complete") ? Response.json(body) : response);
    await expect(uploadReference(file(20))).rejects.toThrow();
  });

  it("validates files before hashing or making requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(uploadReference(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow("为空");
    await expect(uploadReference(file(4 * 1024 * 1024 + 1))).rejects.toThrow("4 MiB");
    expect(fetch).not.toHaveBeenCalled();
  });
});
