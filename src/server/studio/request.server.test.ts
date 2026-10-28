// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertStudioWriteOrigin, readLimitedBody, studioClientAddress } from "./request.server";

describe("anonymous request boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("requires exact origin and refuses cross-site writes", () => {
    const make = (headers: HeadersInit) => new Request("https://studio.example/api/studio/generate", { method: "POST", headers });
    expect(() => assertStudioWriteOrigin(make({ origin: "https://studio.example", "sec-fetch-site": "same-origin" }))).not.toThrow();
    for (const headers of [{}, { origin: "https://evil.example" }, { origin: "https://studio.example", "sec-fetch-site": "cross-site" }] as HeadersInit[]) {
      expect(() => assertStudioWriteOrigin(make(headers))).toThrow();
    }
  });
  it("compares against the configured HTTPS origin behind a production HTTP proxy", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("BETTER_AUTH_URL", "https://studio.example");
    const request = new Request("http://studio.example/api/studio/generate", { method: "POST", headers: { origin: "https://studio.example", "sec-fetch-site": "same-origin" } });
    expect(() => assertStudioWriteOrigin(request)).not.toThrow();
    expect(() => assertStudioWriteOrigin(new Request(request.url, { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } }))).toThrow();
  });
  it("bounds chunked bodies even with missing or dishonest length", async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3)); c.enqueue(new Uint8Array(3)); }, cancel() { cancelled = true; } });
    const request = new Request("https://studio.example", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readLimitedBody(request, 5)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    await expect(readLimitedBody(new Request("https://studio.example", { method: "POST", body: "abc", headers: { "content-length": "100" } }), 5)).rejects.toMatchObject({ status: 413 });
  });
  it("stops reading an aborted streaming upload", async () => {
    const controller = new AbortController(); let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const request = new Request("https://studio.example", { method: "POST", body, signal: controller.signal, duplex: "half" } as RequestInit);
    const reading = readLimitedBody(request, 100);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ status: 408 }); expect(cancelled).toBe(true);
  });
  it("reads accepted bytes and does not trust arbitrary proxy headers", async () => {
    const req = new Request("https://studio.example", { method: "POST", body: "hello", headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } });
    expect(new TextDecoder().decode(await readLimitedBody(req, 5))).toBe("hello");
    expect(studioClientAddress(req)).toBe("unknown");
    expect(studioClientAddress(new Request(req.url, { headers: { "x-studio-client-ip": "1.2.3.4" } }))).toBe("1.2.3.4");
  });
});
