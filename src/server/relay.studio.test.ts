// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const safeRequest = vi.hoisted(() => vi.fn());
vi.mock("./studio/safe-http.server", async (original) => ({
  ...await original<typeof import("./studio/safe-http.server")>(), safeHttpsRequest: safeRequest,
}));
import { callRelay, type CallRelayRequest } from "./relay";

const input = (): CallRelayRequest => ({
  prompt: "private prompt", size: "1024x1024", credential: {
    mode: "custom", apiKey: "fictional-studio-key", baseUrl: "https://provider.example/custom/v1/",
  }, deadlineAt: new Date(Date.now() + 90_000),
});
const response = (value: unknown, status = 200) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(value)) });
describe("studio custom relay", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    safeRequest.mockResolvedValue(response({ data: [{ b64_json: "aGVsbG8=" }] }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ b64_json: "legacy" }] })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the frozen custom base path and pinned safe transport for JSON", async () => {
    await expect(callRelay(input())).resolves.toEqual({ images: [{ b64_json: "aGVsbG8=" }] });
    expect(fetch).not.toHaveBeenCalled();
    expect(safeRequest).toHaveBeenCalledWith("https://provider.example/custom/v1/images/generations", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer fictional-studio-key", "Content-Type": "application/json" },
      maxResponseBytes: expect.any(Number), deadlineAtMs: expect.any(Number),
    }));
    expect(JSON.parse(safeRequest.mock.calls[0][1].body)).toMatchObject({ model: "gpt-image-2", n: 1, response_format: "b64_json" });
  });

  it("uses safe multipart with a maximum 4MiB input image", async () => {
    const req = input();
    req.inputImage = { bytes: Buffer.alloc(4 * 1024 * 1024), contentType: "image/png", filename: "ref.png" };
    await callRelay(req);
    expect(safeRequest).toHaveBeenCalledWith("https://provider.example/custom/v1/images/edits", expect.objectContaining({ body: expect.any(FormData) }));
    req.inputImage.bytes = Buffer.alloc(4 * 1024 * 1024 + 1);
    await expect(callRelay(req)).rejects.toThrow();
    expect(safeRequest).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 429, 500])("returns a fixed message for HTTP %s without leaking any upstream body", async (status) => {
    safeRequest.mockResolvedValue(response({ message: "fictional-studio-key private upstream account password" }, status));
    const error = await callRelay(input()).catch((value) => value);
    expect(error).toMatchObject({ httpStatus: status });
    expect(error.message).not.toMatch(/fictional|private|password/);
    expect(safeRequest).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects HTTP200 error envelopes and malformed JSON with fixed messages", async () => {
    safeRequest.mockResolvedValue(response({ error: { status: 401, message: "private upstream message" } }));
    await expect(callRelay(input())).rejects.toMatchObject({ httpStatus: 401 });
    safeRequest.mockResolvedValue({ status: 200, body: Buffer.from("private invalid JSON"), headers: {} });
    const error = await callRelay(input()).catch((value) => value);
    expect(error).toMatchObject({ failureCode: "invalid_response" });
    expect(error.message).not.toContain("private");
  });
});
