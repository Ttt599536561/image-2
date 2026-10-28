import { isIP } from "node:net";
import { httpError } from "../../contracts/error";

/** Caddy overwrites this private header; never trust user supplied X-Forwarded-For. */
export function studioClientAddress(request: Request): string {
  const address = request.headers.get("x-studio-client-ip")?.trim();
  return address && isIP(address) ? address : "unknown";
}

export function assertStudioWriteOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  // react-router-serve receives HTTP from the HTTPS reverse proxy and does not trust forwarded hosts.
  // Compare with deployment configuration, never a client-provided forwarded header.
  const configured = process.env.NODE_ENV === "production"
    ? process.env.STUDIO_PUBLIC_ORIGIN || process.env.BETTER_AUTH_URL : undefined;
  const expected = new URL(configured || request.url).origin;
  if (origin !== expected || (site !== null && site !== "same-origin")) {
    throw httpError(403, "FORBIDDEN", "请从当前站点提交请求");
  }
}

/** Read incrementally: neither Content-Length nor formData/json may allocate an unbounded body. */
export async function readLimitedBody(request: Request, maximum: number, timeoutMs = 15_000): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    void request.body?.cancel().catch(() => {});
    throw httpError(413, "BODY_TOO_LARGE", "请求体过大");
  }
  if (!request.body) return new Uint8Array();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(httpError(408, "REQUEST_TIMEOUT", "请求超时，请重试"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw httpError(413, "BODY_TOO_LARGE", "请求体过大");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
