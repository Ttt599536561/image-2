import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareReferenceCopy } from "./referenceCopy";

const LIMIT = 4 * 1024 * 1024;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockEncoder(sizes: Array<number | null>, dimensions = { width: 1536, height: 1024 }) {
  const close = vi.fn();
  const bitmap = { ...dimensions, close };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  const drawImage = vi.fn();
  const clearRect = vi.fn();
  const getContext = vi.fn(() => ({ drawImage, clearRect }));
  const encodings: Array<{ width: number; height: number; type: string; quality: number }> = [];
  const canvas = { width: 0, height: 0, getContext, toBlob(callback: BlobCallback, type: string, quality: number) {
    encodings.push({ width: this.width, height: this.height, type, quality });
    const size = sizes.shift();
    callback(size === null ? null : new Blob([new Uint8Array(size ?? LIMIT + 1)], { type }));
  } };
  vi.spyOn(document, "createElement").mockImplementation(() => canvas as unknown as HTMLCanvasElement);
  return { encodings, close, drawImage, clearRect, getContext };
}

describe("generated image reference copies", () => {
  it("uses a small original directly without decoding or re-encoding", async () => {
    const decoder = vi.fn(); vi.stubGlobal("createImageBitmap", decoder);
    const original = new Blob(["original bytes"], { type: "image/png" });
    const prepared = await prepareReferenceCopy(original, "small");
    expect(prepared.converted).toBe(false);
    expect(prepared.file.size).toBe(original.size);
    expect(prepared.file.type).toBe("image/png");
    expect(decoder).not.toHaveBeenCalled();
  });
  it("tries original dimensions before scaling and returns a transparent WebP under 4 MiB", async () => {
    const encoder = mockEncoder([LIMIT + 1, LIMIT - 1]);
    const original = new Blob([new Uint8Array(LIMIT + 100)], { type: "image/png" });
    const stored = { blob: original };
    const prepared = await prepareReferenceCopy(stored.blob, "large");
    expect(prepared.converted).toBe(true);
    expect(prepared.file.size).toBeLessThanOrEqual(LIMIT);
    expect(prepared.file.type).toBe("image/webp");
    expect(prepared.file.name).toBe("参考图_large.webp");
    expect(encoder.encodings).toHaveLength(2);
    expect(encoder.encodings.every((item) => item.width === 1536 && item.height === 1024)).toBe(true);
    expect(encoder.getContext).toHaveBeenCalledWith("2d", { alpha: true });
    expect(encoder.clearRect).toHaveBeenCalled();
    expect(stored.blob).toBe(original);
    expect(stored.blob.size).toBe(LIMIT + 100);
    expect(stored.blob.type).toBe("image/png");
    expect(encoder.close).toHaveBeenCalledTimes(1);
  });
  it("reduces dimensions only after reasonable quality options cannot fit the original size", async () => {
    const encoder = mockEncoder([LIMIT + 1, LIMIT + 1, LIMIT + 1, LIMIT + 1, LIMIT - 1]);
    const prepared = await prepareReferenceCopy(new Blob([new Uint8Array(LIMIT + 100)], { type: "image/png" }), "scaled");
    expect(prepared.file.size).toBeLessThanOrEqual(LIMIT);
    expect(encoder.encodings.slice(0, 4).every((item) => item.width === 1536 && item.height === 1024)).toBe(true);
    expect(encoder.encodings[4].width).toBeLessThan(1536);
    expect(encoder.encodings[4].width / encoder.encodings[4].height).toBeCloseTo(1.5, 2);
  });
  it("reports encoding failure and releases the decoded original", async () => {
    const encoder = mockEncoder([null]);
    await expect(prepareReferenceCopy(new Blob([new Uint8Array(LIMIT + 1)], { type: "image/png" }), "failed")).rejects.toThrow(/参考副本.*原图不受影响/);
    expect(encoder.close).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before allocating a decoder", async () => {
    const decoder = vi.fn(); vi.stubGlobal("createImageBitmap", decoder);
    const controller = new AbortController(); controller.abort();
    await expect(prepareReferenceCopy(new Blob([new Uint8Array(LIMIT + 1)], { type: "image/png" }), "cancelled", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(decoder).not.toHaveBeenCalled();
  });
});
