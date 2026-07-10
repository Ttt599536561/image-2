// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerBackground } from "./trigger";

const originalUrl = process.env.URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.URL;
  else process.env.URL = originalUrl;
});

describe("triggerBackground", () => {
  it("sends only the generation id to the background function", async () => {
    process.env.URL = "https://site.invalid";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await triggerBackground("00000000-0000-4000-8000-000000000001");

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://site.invalid/.netlify/functions/generate-background",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      generationId: "00000000-0000-4000-8000-000000000001",
    });
  });
});
