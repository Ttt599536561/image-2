import { STUDIO_UPLOAD_CHUNK_BYTES, StudioUploadSession, StudioUploadChunkResult, StudioUploadCompleteResult } from "../../contracts/studio-upload";

const ENDPOINT = "/api/studio/uploads/resumable";
const FAILURE = "任务暂未完成，请重试此任务。";
const TRANSIENT = new Set([408, 500, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 10_000;
type UploadState = { uploadId: string; sha256: Promise<string>; nextIndex: number; pending?: Promise<string> };
// Original files, progress and hashes remain private to this page and are released with the File.
const uploads = new WeakMap<File, UploadState>();

class UploadFailure extends Error {
  constructor(readonly status = 0, readonly retryAfter: string | null = null) { super(FAILURE); }
}
function retryDelay(error: unknown, attempt: number): number | null {
  const fallback = 250 * 2 ** attempt;
  if (error instanceof UploadFailure) {
    if (!TRANSIENT.has(error.status) && error.status !== 429) return null;
    if (error.retryAfter === null) return fallback;
    const seconds = /^\d+(?:\.\d+)?$/.test(error.retryAfter.trim()) ? Number(error.retryAfter) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(error.retryAfter) - Date.now();
    // A long server backoff requires a later manual retry; do not retry before that time.
    return Number.isFinite(delay) && delay <= MAX_RETRY_WAIT_MS ? Math.max(0, delay) : null;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError") ? fallback : null;
}

async function request(url: string, init: RequestInit, deadlineMs = 20_000): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    let delay: number | null;
    try {
      const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new UploadFailure(response.status, response.headers.get("Retry-After"));
      // Keep the deadline active while receiving the response body as well as its headers.
      return await response.json();
    } catch (error) {
      delay = retryDelay(error, attempt);
      if (attempt === 2 || delay === null) throw error instanceof UploadFailure ? error : new UploadFailure();
    } finally {
      clearTimeout(timer);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  throw new UploadFailure();
}

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= 300 && key.startsWith("uploads/") &&
    !/[\\\s\u0000-\u001f]/.test(key) && key.split("/").every((part) => part && part !== "." && part !== "..");
}

async function transfer(file: File, state: UploadState): Promise<string> {
  const sha256 = await state.sha256;
  const count = Math.ceil(file.size / STUDIO_UPLOAD_CHUNK_BYTES);
  // One restart handles expiry during a slow upload; repeated expiry must not loop forever.
  for (let restart = 0; restart < 2; restart++) {
    try {
      const created = StudioUploadSession.safeParse(await request(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: state.uploadId, size: file.size, mime: file.type, sha256 }),
      }));
      if (!created.success) throw new UploadFailure();
      const session = created.data;
      if (session.uploadId !== state.uploadId || session.chunkSize !== STUDIO_UPLOAD_CHUNK_BYTES ||
        !Number.isInteger(session.nextIndex) || session.nextIndex < 0 || session.nextIndex > count ||
        !Number.isFinite(Date.parse(session.expiresAt))) throw new UploadFailure();
      // The server's 410 is authoritative; browser wall clocks may be ahead or behind.
      state.nextIndex = session.nextIndex;
      if (session.inputImageKey !== undefined) {
        if (state.nextIndex !== count || !validKey(session.inputImageKey)) throw new UploadFailure();
        return session.inputImageKey;
      }
      while (state.nextIndex < count) {
        const index = state.nextIndex;
        const result = StudioUploadChunkResult.safeParse(await request(`${ENDPOINT}/${state.uploadId}/${index}`, {
          method: "PUT", headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(index * STUDIO_UPLOAD_CHUNK_BYTES, Math.min((index + 1) * STUDIO_UPLOAD_CHUNK_BYTES, file.size)),
        }));
        // A response can only acknowledge the one sequential chunk we sent.
        if (!result.success || result.data.nextIndex !== index + 1) throw new UploadFailure();
        state.nextIndex = result.data.nextIndex;
      }
      const completed = StudioUploadCompleteResult.safeParse(await request(`${ENDPOINT}/${state.uploadId}/complete`, { method: "POST" }, 40_000));
      if (!completed.success || !validKey(completed.data.inputImageKey)) throw new UploadFailure();
      return completed.data.inputImageKey;
    } catch (error) {
      if (!(error instanceof UploadFailure) || error.status !== 410 || restart === 1) throw new UploadFailure();
      state.uploadId = crypto.randomUUID();
      state.nextIndex = 0;
    }
  }
  throw new UploadFailure();
}

export function uploadResumableReference(file: File): Promise<string> {
  let state = uploads.get(file);
  if (!state) {
    state = { uploadId: crypto.randomUUID(), nextIndex: 0, sha256: file.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes)).then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")) };
    uploads.set(file, state);
  }
  if (!state.pending) {
    const current = state;
    current.pending = transfer(file, current).catch(() => { throw new Error(FAILURE); }).finally(() => { current.pending = undefined; });
  }
  return state.pending!;
}
