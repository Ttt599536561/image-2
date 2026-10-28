import type { StudioAccepted, StudioGenerateRequest, StudioSessionInfo, StudioStatusBatch } from "../../contracts/studio";

export class StudioApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message;
    throw new StudioApiError(typeof message === "string" ? message : `请求未完成（${response.status}）`, response.status);
  }
  return body as T;
}
export async function getStudioSession(): Promise<StudioSessionInfo> {
  return readResponse(await fetch("/api/studio/session", { credentials: "same-origin", cache: "no-store" }));
}
export async function submitGeneration(request: StudioGenerateRequest): Promise<StudioAccepted> {
  return readResponse(await fetch("/api/studio/generate", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  }));
}
export function validateReferenceImage(file: File): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "请使用 PNG、JPG 或 WebP 图片。";
  if (file.size > 4 * 1024 * 1024) return "参考图片不能超过 4 MiB。";
  if (!file.size) return "图片文件为空。";
  return null;
}
export async function uploadReference(file: File): Promise<string> {
  const invalid = validateReferenceImage(file);
  if (invalid) throw new Error(invalid);
  const form = new FormData(); form.set("file", file);
  const result = await readResponse<{ inputImageKey: string }>(await fetch("/api/studio/uploads", { method: "POST", credentials: "same-origin", body: form }));
  return result.inputImageKey;
}
export async function getStudioStatus(ids: string[]): Promise<StudioStatusBatch> {
  return readResponse(await fetch(`/api/studio/status?ids=${encodeURIComponent(ids.join(","))}`, { credentials: "same-origin", cache: "no-store" }));
}
export async function fetchResultBlob(url: string): Promise<Blob> {
  const resolved = new URL(url, window.location.origin);
  if (resolved.origin !== window.location.origin || !resolved.pathname.startsWith("/api/studio/images/")) throw new Error("图片地址无效");
  const response = await fetch(resolved.href, { credentials: "same-origin" });
  if (!response.ok) throw new Error("图片暂时无法读取，请稍后重试");
  return response.blob();
}
