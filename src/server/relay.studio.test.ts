// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const safeRequest = vi.hoisted(() => vi.fn());
vi.mock("./studio/safe-http.server", async (original) => ({
  ...await original<typeof import("./studio/safe-http.server")>(), safeHttpsRequest: safeRequest,
}));
import { callRelay, type CallRelayRequest } from "./relay";

const input = (): CallRelayRequest => ({
  prompt: "private prompt", size: "1024x1024", credential: {
    mode: "custom", apiKey: "fictional-studio-key", baseUrl: "https://api.tangguo.xin/v1",
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
    expect(safeRequest).toHaveBeenCalledWith("https://api.tangguo.xin/v1/images/generations", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer fictional-studio-key", "Content-Type": "application/json" },
      maxResponseBytes: expect.any(Number), deadlineAtMs: expect.any(Number),
    }));
    expect(JSON.parse(safeRequest.mock.calls[0][1].body)).toMatchObject({ model: "gpt-image-2", n: 1, response_format: "b64_json" });
  });

  it("uses safe multipart with a maximum 4MiB input image", async () => {
    const req = input();
    req.inputImage = { bytes: Buffer.alloc(4 * 1024 * 1024), contentType: "image/png", filename: "ref.png" };
    await callRelay(req);
    expect(safeRequest).toHaveBeenCalledWith("https://api.tangguo.xin/v1/images/edits", expect.objectContaining({ body: expect.any(FormData) }));
    req.inputImage.bytes = Buffer.alloc(4 * 1024 * 1024 + 1);
    await expect(callRelay(req)).rejects.toThrow();
    expect(safeRequest).toHaveBeenCalledOnce();
  });
  it.each(["gpt-image-2", "gpt-image-2.5-sunburst"] as const)("sends %s in JSON and preserves four ordered original images in multipart", async (model) => {
    await callRelay({ ...input(), model });
    expect(JSON.parse(safeRequest.mock.calls[0][1].body).model).toBe(model);
    const inputImages = [1, 2, 3, 4].map((n) => ({ bytes: new Uint8Array([0, n, 255, n + 10]), contentType: "image/png", filename: `ref-${n}.png` }));
    await callRelay({ ...input(), model, inputImages });
    const form = safeRequest.mock.calls[1][1].body as FormData;
    expect(form.get("model")).toBe(model);
    expect(form.get("n")).toBe("1");
    expect(form.get("response_format")).toBe("b64_json");
    const images = form.getAll("image[]") as File[];
    expect(images.map((file) => file.name)).toEqual(inputImages.map((file) => file.filename));
    for (const [index, file] of images.entries()) expect(new Uint8Array(await file.arrayBuffer())).toEqual(inputImages[index].bytes);
  });
  it("rejects replaced endpoints and invalid multiple inputs without any transport", async () => {
    const image = { bytes: new Uint8Array([1]), contentType: "image/png", filename: "ref.png" };
    for (const patch of [
      { credential: { mode: "custom" as const, apiKey: "fictional", baseUrl: "https://evil.example/v1" } },
      { inputImages: Array(5).fill(image) },
      { inputImages: [image, { ...image, bytes: new Uint8Array(4 * 1024 * 1024 + 1) }] },
      { inputImages: [image], inputImage: image },
    ]) await expect(callRelay({ ...input(), ...patch })).rejects.toThrow();
    expect(safeRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
