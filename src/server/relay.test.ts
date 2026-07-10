// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { callRelay, relayTimeoutMs } from "./relay";

afterEach(() => vi.unstubAllGlobals());

function successResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({ data: [{ b64_json: "aGVsbG8=" }], ...extra });
}

describe("custom relay target", () => {
  it("uses the fixed base, custom bearer, and remaining deadline", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse());
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "p",
      size: "1024x1024",
      credential: { mode: "custom", apiKey: "fictional-relay-token" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/generations");
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer fictional-relay-token",
    );
    expect(relayTimeoutMs(Date.now() + 90_000, Date.now())).toBeGreaterThanOrEqual(59_900);
    expect(relayTimeoutMs(Date.now() + 20_000, Date.now())).toBe(0);
  });

  it("uses the same custom target for image edits", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => successResponse());
    vi.stubGlobal("fetch", fetchMock);
    await callRelay({
      prompt: "edit",
      size: "1024x1024",
      inputImage: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "ref.png" },
      credential: { mode: "custom", apiKey: "fictional-edit-token" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tangguo.xin/v1/images/edits");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("never returns a successful raw body that echoes the active key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successResponse({ debug: { authorization: "fictional-success-echo" } })),
    );
    const result = await callRelay({
      prompt: "p",
      size: "1024x1024",
      credential: { mode: "custom", apiKey: "fictional-success-echo" },
      deadlineAt: new Date(Date.now() + 90_000),
    });
    expect(Object.keys(result)).toEqual(["images"]);
    expect(JSON.stringify(result)).not.toContain("fictional-success-echo");
  });

  it("marks malformed provider JSON without echoing the active key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ debug: "fictional-malformed-echo" })),
    );
    await expect(
      callRelay({
        prompt: "p",
        size: "1024x1024",
        credential: { mode: "custom", apiKey: "fictional-malformed-echo" },
        deadlineAt: new Date(Date.now() + 90_000),
      }),
    ).rejects.toMatchObject({ failureCode: "invalid_response" });
  });
});
