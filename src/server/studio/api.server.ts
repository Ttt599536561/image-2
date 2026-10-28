import { z } from "zod";
import { httpError } from "../../contracts/error";
import { DEFAULT_STUDIO_BASE_URL, STUDIO_MODEL, StudioGenerateRequest, type StudioJobStatus, type StudioSessionInfo, type StudioStatusBatch } from "../../contracts/studio";
import { UPLOAD_ACCEPT, UPLOAD_EXT, UPLOAD_MAX_BYTES, sniffImageMime, type UploadMime } from "../../contracts/upload";
import { getSql } from "../../db/db.server";
import { usesPgDriver } from "../../db/db-driver.server";
import { enqueueGeneration } from "../generation/enqueue";
import { loadGenerationStatuses, parseGenerationStatusQuery } from "../generation/status.server";
import { subscribeGenerationChanges } from "../generation/notifications.server";
import { getStoredImageObject, putUserUpload } from "../r2.server";
import { consumeStudioRate, type StudioRateScope } from "./limits.server";
import { assertStudioWriteOrigin, readLimitedBody } from "./request.server";
import { normalizeStudioBaseUrl } from "./safe-http.server";
import { getOrCreateStudioSession, requireStudioSession } from "./session.server";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response {
  if (error instanceof Response) {
    for (const [key, value] of Object.entries(privateHeaders)) error.headers.set(key, value);
    return error;
  }
  const response = httpError(500, "INTERNAL", "服务异常，请重试");
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}
function post(request: Request): void {
  if (request.method !== "POST") throw httpError(405, "INVALID_PARAM", "method_not_allowed");
  assertStudioWriteOrigin(request);
}
async function limitedOwner(request: Request, scope: StudioRateScope) {
  // Reject excessive IP traffic before an attacker can force arbitrary session hash lookups.
  await consumeStudioRate(request, scope);
  const owner = await requireStudioSession(request);
  await consumeStudioRate(request, scope, owner.userId, { ownerOnly: true });
  return owner;
}

export async function studioSessionLoader(request: Request): Promise<Response> {
  try {
    await consumeStudioRate(request, "read");
    const session = await getOrCreateStudioSession(request);
    const info: StudioSessionInfo = { ok: true, defaults: { baseUrl: DEFAULT_STUDIO_BASE_URL, model: STUDIO_MODEL }, limits: { maxPromptLength: 4000, maxUploadBytes: UPLOAD_MAX_BYTES, maxInflight: 10 } };
    return Response.json(info, { headers: { ...privateHeaders, ...(session.cookie ? { "Set-Cookie": session.cookie } : {}) } });
  } catch (error) { return failure(error); }
}

export async function studioGenerateAction(request: Request): Promise<Response> {
  try {
    post(request);
    const owner = await limitedOwner(request, "generate");
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw httpError(415, "INVALID_PARAM", "请提交 JSON 请求");
    const bytes = await readLimitedBody(request, 32 * 1024);
    let json: unknown;
    try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw httpError(400, "INVALID_PARAM", "请求体无效"); }
    const parsed = StudioGenerateRequest.safeParse(json);
    if (!parsed.success) throw httpError(400, "INVALID_PARAM", "生成参数无效");
    const { baseUrl, apiKey, inputImageKey, ...params } = parsed.data;
    let normalized: string;
    try { normalized = normalizeStudioBaseUrl(baseUrl); }
    catch { throw httpError(400, "INVALID_PARAM", "请输入有效的公网 HTTPS 服务地址"); }
    if (inputImageKey) {
      const prefix = `uploads/${owner.userId}/`;
      if (!inputImageKey.startsWith(prefix) || !/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(inputImageKey.slice(prefix.length))) {
        throw httpError(400, "INVALID_PARAM", "参考图无效");
      }
    }
    const result = await enqueueGeneration({ user: { id: owner.userId, maxConcurrency: 10 }, input: { ...params, inputImageKey, credentialMode: "custom", customApiKey: apiKey, customBaseUrl: normalized } });
    return Response.json({ generationId: result.generationId, conversationId: result.conversationId, status: "queued", deadlineAt: result.deadlineAt }, { status: 202, headers: privateHeaders });
  } catch (error) { return failure(error); }
}

/** Explicit projection prevents legacy status/money/source fields from escaping the studio. */
export async function loadStudioStatuses(userId: string, ids: string[]): Promise<StudioStatusBatch> {
  const legacy = await loadGenerationStatuses(userId, ids);
  const items: StudioJobStatus[] = legacy.map((row) => {
    const identity = { generationId: row.generationId, status: row.status, deadlineAt: row.deadlineAt };
    if (row.status === "succeeded") return { ...identity, durationMs: row.durationMs, ...(row.image?.id ? { image: { id: row.image.id, url: `/api/studio/images/${row.image.id}`, width: row.image.width, height: row.image.height } } : {}) };
    if (row.status === "failed") return { ...identity, error: { code: row.errorCode, message: studioErrorMessage(row.errorCode) } };
    return { ...identity, startedAt: row.startedAt, elapsedMs: row.elapsedMs };
  });
  const found = new Set(items.map((item) => item.generationId));
  return { items, missingIds: ids.filter((id) => !found.has(id)) };
}
function studioErrorMessage(code: string): string {
  // Upstream response text may echo secrets or contain old billing copy. Emit fixed safe messages.
  if (code === "provider_timeout") return "生成超时，请检查服务后重新提交";
  if (code === "custom_key_invalid") return "服务未接受此 Key，请检查连接设置";
  if (code === "custom_key_quota") return "上游 Key 额度不足，请检查服务账户";
  if (code === "relay_rate_limited") return "上游服务繁忙，请稍后再试";
  if (code === "content_rejected") return "服务未接受此提示词，请修改后重试";
  return "生成失败，请检查连接设置后重试";
}
export async function studioStatusLoader(request: Request): Promise<Response> {
  try {
    const { userId } = await limitedOwner(request, "read");
    const query = parseGenerationStatusQuery(request.url);
    if (!query.ok) throw httpError(400, "INVALID_PARAM", "任务 ID 无效");
    return Response.json(await loadStudioStatuses(userId, query.ids), { headers: privateHeaders });
  } catch (error) { return failure(error); }
}

export async function studioUploadsAction(request: Request): Promise<Response> {
  try {
    post(request);
    const { userId } = await limitedOwner(request, "upload");
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data;/i.test(contentType)) throw httpError(415, "INVALID_PARAM", "请上传图片文件");
    const bytes = await readLimitedBody(request, UPLOAD_MAX_BYTES + 64 * 1024);
    let form: FormData;
    try { form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw httpError(400, "INVALID_PARAM", "上传内容无效"); }
    const fields = [...form.entries()];
    const file = form.get("file");
    if (fields.length !== 1 || !(file instanceof File)) throw httpError(400, "INVALID_PARAM", "请上传一张参考图");
    if (!UPLOAD_ACCEPT.includes(file.type as UploadMime) || file.size <= 0 || file.size > UPLOAD_MAX_BYTES) throw httpError(400, "INVALID_PARAM", "仅支持不超过 4MB 的 PNG / JPG / WEBP 图片");
    const image = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImageMime(image);
    const fullPng = mime !== "image/png" || [137,80,78,71,13,10,26,10].every((b, index) => image[index] === b);
    if (!mime || !fullPng) throw httpError(400, "INVALID_PARAM", "文件不是有效的 PNG / JPG / WEBP 图片");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const { storageKey } = await putUserUpload({ userId, bytes: image, contentType: mime, ext: UPLOAD_EXT[mime], signal });
    return Response.json({ inputImageKey: storageKey }, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}

export async function studioImageLoader(request: Request, id: string | undefined): Promise<Response> {
  try {
    const { userId } = await limitedOwner(request, "read");
    if (!z.uuid().safeParse(id).success) throw httpError(404, "NOT_FOUND", "图片不存在");
    const rows = await getSql()`SELECT storage_key FROM images WHERE id=${id} AND user_id=${userId} AND expires_at>now()`;
    if (!rows[0]) throw httpError(404, "NOT_FOUND", "图片不存在或已过期");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    const object = await getStoredImageObject(rows[0].storage_key as string, signal);
    if (object.bytes.byteLength > 64 * 1024 * 1024) throw httpError(413, "BODY_TOO_LARGE", "图片过大");
    return new Response(new Uint8Array(object.bytes), { headers: { ...privateHeaders, "Content-Type": object.contentType, "Content-Length": String(object.bytes.byteLength), "Content-Disposition": `inline; filename="image-${id}"` } });
  } catch (error) { return failure(error); }
}

/** Shared PG listener is a wake-up hint; every snapshot and recovery poll queries this owner. */
export async function studioEventsLoader(request: Request): Promise<Response> {
  try {
    const { userId } = await limitedOwner(request, "events");
    const query = parseGenerationStatusQuery(request.url);
    if (!query.ok) throw httpError(400, "INVALID_PARAM", "任务 ID 无效");
    if (!usesPgDriver()) throw httpError(503, "INTERNAL", "请使用状态查询");
    const ids = new Set(query.ids);
    const encoder = new TextEncoder();
    let finish = (_close = true) => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false, loading = false, dirty = false;
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lifetime: ReturnType<typeof setTimeout> | undefined;
        finish = (close = true) => {
          if (closed) return;
          closed = true; unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (lifetime) clearTimeout(lifetime);
          request.signal.removeEventListener("abort", onAbort);
          if (close) controller.close();
        };
        const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
        const refresh = async () => {
          if (closed) return;
          if (loading) { dirty = true; return; }
          loading = true;
          try {
            do {
              dirty = false;
              const batch = await loadStudioStatuses(userId, query.ids);
              if (closed) return;
              send(`event: status\ndata: ${JSON.stringify(batch)}\n\n`);
            } while (dirty && !closed);
          } catch { finish(); }
          finally { loading = false; }
        };
        const onAbort = () => finish();
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) { finish(); return; }
        send("retry: 5000\n\n");
        unsubscribe = subscribeGenerationChanges((change) => { if (change.userId === userId && ids.has(change.generationId)) void refresh(); }, () => { void refresh(); });
        void refresh();
        heartbeat = setInterval(() => { send(": heartbeat\n\n"); void refresh(); }, 15_000);
        lifetime = setTimeout(finish, 60_000);
        heartbeat.unref?.(); lifetime.unref?.();
      },
      cancel() { finish(false); },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-store, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
