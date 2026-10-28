const REFERENCE_LIMIT = 4 * 1024 * 1024;
const CONVERSION_ERROR = "无法生成 4 MiB 以内的参考副本，原图不受影响。请下载原图后缩小再上传。";
type DecodedImage = { source: CanvasImageSource; width: number; height: number; dispose: () => void };

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Reference preparation cancelled", "AbortError");
}
async function decode(blob: Blob, signal?: AbortSignal): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const item = new Image();
      const cleanup = () => { item.onload = null; item.onerror = null; signal?.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); item.src = ""; reject(new DOMException("Reference preparation cancelled", "AbortError")); };
      item.onload = () => { cleanup(); resolve(item); };
      item.onerror = () => { cleanup(); reject(new Error(CONVERSION_ERROR)); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      item.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => { image.src = ""; } };
  } finally { URL.revokeObjectURL(url); }
}
function encode(canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Reference preparation cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      checkCancelled(signal);
      canvas.toBlob((blob) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) { abort(); return; }
        if (!blob?.size || blob.type !== "image/webp") reject(new Error(CONVERSION_ERROR));
        else resolve(blob);
      }, "image/webp", quality);
    } catch (cause) { signal?.removeEventListener("abort", abort); reject(cause); }
  });
}

/** Makes only an upload copy. The original Blob is never replaced or persisted here. */
export async function prepareReferenceCopy(blob: Blob, generationId: string, signal?: AbortSignal): Promise<{ file: File; converted: boolean }> {
  checkCancelled(signal);
  if (!blob.size || !["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("原图格式无法作为参考图片，请使用 PNG、JPG 或 WebP。");
  if (blob.size <= REFERENCE_LIMIT) {
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    return { file: new File([blob], `参考图_${generationId}.${extension}`, { type: blob.type }), converted: false };
  }
  let decoded: DecodedImage | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    decoded = await decode(blob, signal);
    checkCancelled(signal);
    if (!decoded.width || !decoded.height) throw new Error(CONVERSION_ERROR);
    canvas = document.createElement("canvas");
    // Alpha stays enabled, with no background fill; WebP retains transparent pixels.
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error(CONVERSION_ERROR);
    for (let step = 0; step < 16; step++) {
      checkCancelled(signal);
      const scale = .8 ** step;
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [.9, .8, .7, .6]) {
        const copy = await encode(canvas, quality, signal);
        if (copy.size <= REFERENCE_LIMIT) return { file: new File([copy], `参考图_${generationId}.webp`, { type: "image/webp" }), converted: true };
      }
      if (Math.max(canvas.width, canvas.height) <= 256) break;
    }
    throw new Error(CONVERSION_ERROR);
  } catch (cause) {
    if (signal?.aborted || (cause instanceof DOMException && cause.name === "AbortError")) throw new DOMException("Reference preparation cancelled", "AbortError");
    throw new Error(CONVERSION_ERROR);
  } finally {
    decoded?.dispose();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
