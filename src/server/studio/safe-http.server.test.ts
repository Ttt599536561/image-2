// @vitest-environment node
import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { isPublicIpAddress, normalizeStudioBaseUrl, safeHttpsRequest } from "./safe-http.server";

describe("public HTTPS boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    "0.0.0.0", "10.2.3.4", "127.0.0.1", "100.100.100.200", "169.254.169.254",
    "172.31.3.4", "192.168.1.1", "192.0.0.8", "192.0.2.1", "192.88.99.1",
    "198.18.1.1", "198.51.100.2", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "168.63.129.16", "::", "::1", "fc00::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:93.184.216.34", "64:ff9b::a00:1", "2002:7f00:1::",
    "2001::1", "2001:db8::1", "3ffe::1", "3fff::1",
  ])("rejects special-purpose address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])("accepts public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "http://api.example/v1", "https://user:secret@api.example/v1", "https://@api.example/v1",
    "https://api.example/v1?key=secret", "https://api.example/v1?", "https://api.example/v1#",
    "https://127.1", "https://0x7f000001", "https://2130706433", "https://[::ffff:7f00:1]",
    "https://localhost", "https://metadata.google.internal", "https://api.example\\@127.0.0.1",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() => normalizeStudioBaseUrl(baseUrl)).toThrow();
  });

  it("normalizes root and v1 without losing a custom base path", () => {
    expect(normalizeStudioBaseUrl(" https://API.example/ ")).toBe("https://api.example/v1");
    expect(normalizeStudioBaseUrl("https://api.example/v1///")).toBe("https://api.example/v1");
    expect(normalizeStudioBaseUrl("https://api.example/proxy/openai/v2/")).toBe("https://api.example/proxy/openai/v2");
  });

  function transport(status = 200, headers: Record<string, string> = {}) {
    const response = Object.assign(new PassThrough(), { statusCode: status, headers });
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    mocks.request.mockImplementation((_url, _options, callback) => {
      request.end.mockImplementation(() => { callback(response); });
      return request;
    });
    return { request, response };
  }
  const options = () => ({ deadlineAtMs: Date.now() + 1_000, maxResponseBytes: 16 });

  it("rejects all DNS answers if even one address is private", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(safeHttpsRequest("https://api.example/image", options())).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("pins the actual request lookup to an approved IP while preserving hostname and TLS validation", async () => {
    const { response } = transport();
    const work = safeHttpsRequest("https://api.example/image?signature=private", options());
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    const [url, opts] = mocks.request.mock.calls[0];
    expect(String(url)).toBe("https://api.example/image?signature=private");
    expect(opts).toMatchObject({ servername: "api.example", rejectUnauthorized: true, agent: false });
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const connected = vi.fn();
    opts.lookup("api.example", {}, connected);
    expect(connected).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    response.end("ok");
    expect((await work).body.toString()).toBe("ok");
  });

  it("refuses redirects without contacting their target", async () => {
    const { response } = transport(302, { location: "http://169.254.169.254/private" });
    await expect(safeHttpsRequest("https://api.example/image", options())).rejects.toThrow(/redirect/i);
    expect(response.destroyed).toBe(true);
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("caps bodies without trusting Content-Length", async () => {
    const { response, request } = transport();
    const work = safeHttpsRequest("https://api.example/image", options());
    const result = expect(work).rejects.toThrow(/too large/i);
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    response.write(Buffer.alloc(17));
    await result;
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before buffering the body", async () => {
    transport(200, { "content-length": "1000" });
    await expect(safeHttpsRequest("https://api.example/image", options())).rejects.toThrow(/too large/i);
  });

  it("rejects compressed responses to keep the byte budget unambiguous", async () => {
    transport(200, { "content-encoding": "gzip" });
    await expect(safeHttpsRequest("https://api.example/image", options())).rejects.toThrow();
  });

  it("deadline includes DNS resolution and never sends a request after it expires", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    mocks.lookup.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const result = expect(safeHttpsRequest("https://api.example/image", options())).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    resolve([{ address: "93.184.216.34", family: 4 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("a slow stream cannot extend the overall deadline and cancellation listeners are removed", async () => {
    vi.useFakeTimers();
    const { response, request } = transport();
    const controller = new AbortController();
    const result = expect(safeHttpsRequest("https://api.example/image", { ...options(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    response.write("x");
    await vi.advanceTimersByTimeAsync(500);
    response.write("x");
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("sanitizes network and caller abort errors", async () => {
    mocks.lookup.mockRejectedValue(new Error("private hostname and key"));
    await expect(safeHttpsRequest("https://api.example/image", options())).rejects.not.toThrow(/private/);
    const controller = new AbortController();
    controller.abort(new Error("private abort reason"));
    await expect(safeHttpsRequest("https://api.example/image", { ...options(), signal: controller.signal })).rejects.not.toThrow(/private/);
  });

  it("encodes bounded multipart before sending with a valid boundary and content length", async () => {
    const { response, request } = transport();
    const form = new FormData();
    form.append("prompt", "a fixture");
    form.append("image", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "fixture.png");
    const work = safeHttpsRequest("https://api.example/images/edits", { ...options(), method: "POST", body: form });
    await vi.waitFor(() => expect(request.end).toHaveBeenCalled());
    const [, opts] = mocks.request.mock.calls[0];
    const body = request.end.mock.calls[0][0] as Buffer;
    expect(opts.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(opts.headers["Content-Length"]).toBe(String(body.length));
    expect(body.toString()).toContain('name="image"; filename="fixture.png"');
    expect(body.toString()).toContain("a fixture");
    response.end("ok");
    await work;
  });

  it("rejects oversized outgoing bodies before opening a socket", async () => {
    const form = new FormData();
    form.append("image", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]));
    await expect(safeHttpsRequest("https://api.example/image", { ...options(), body: form })).rejects.toThrow(/large/i);
    await expect(safeHttpsRequest("https://api.example/image", { ...options(), body: Buffer.alloc(5 * 1024 * 1024 + 1) })).rejects.toThrow(/large/i);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("cancels a stalled request upload without exposing the caller abort reason", async () => {
    const { response, request } = transport();
    mocks.request.mockImplementation(() => request); // No headers or response body arrive.
    const controller = new AbortController();
    const work = safeHttpsRequest("https://api.example/image", { ...options(), signal: controller.signal, method: "POST", body: "{}" });
    const result = expect(work).rejects.toMatchObject({ name: "AbortError", message: "request deadline exceeded" });
    await vi.waitFor(() => expect(request.end).toHaveBeenCalled());
    controller.abort(new Error("private user credential"));
    await result;
    expect(request.destroy).toHaveBeenCalledOnce();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    response.destroy();
  });
});
