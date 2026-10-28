import { z } from "zod";
import { httpError } from "../../contracts/error";
import { STUDIO_UPLOAD_CHUNK_BYTES, StudioUploadCreateRequest } from "../../contracts/studio-upload";
import { consumeStudioRate, type StudioRateScope } from "./limits.server";
import { assertStudioWriteOrigin, readLimitedBody, studioClientAddress } from "./request.server";
import { requireStudioSession } from "./session.server";
import { completeStudioUpload, createStudioUpload, writeStudioUploadChunk } from "./resumable-upload.server";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown): Response {
  const response = error instanceof Response ? error : httpError(500, "INTERNAL", "服务异常，请重试");
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
async function authorize(request: Request, method: "POST" | "PUT", scope: StudioRateScope, uploadId?: string) {
  if (request.method !== method) throw httpError(405, "INVALID_PARAM", "method_not_allowed");
  assertStudioWriteOrigin(request);
  await consumeStudioRate(request, scope);
  const owner = await requireStudioSession(request);
  await consumeStudioRate(request, scope, owner.userId, { ownerOnly: true, ...(uploadId ? { uploadId } : {}) });
  return owner.userId;
}
function validId(id: string | undefined): string {
  if (!z.uuid().safeParse(id).success) throw httpError(400, "INVALID_PARAM", "上传 ID 无效");
  return id!;
}
export async function studioUploadCreateAction(request: Request): Promise<Response> {
  try {
    const owner = await authorize(request, "POST", "upload");
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw httpError(415, "INVALID_PARAM", "请提交 JSON 请求");
    const bytes = await readLimitedBody(request, 1024);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw httpError(400, "INVALID_PARAM", "上传参数无效"); }
    const parsed = StudioUploadCreateRequest.safeParse(value);
    if (!parsed.success) throw httpError(400, "INVALID_PARAM", "上传参数无效");
    return Response.json(await createStudioUpload(owner, studioClientAddress(request), parsed.data), { headers });
  } catch (error) { return failure(error); }
}
export async function studioUploadChunkAction(request: Request, id: string | undefined, index: string | undefined): Promise<Response> {
  try {
    const uploadId = validId(id);
    const owner = await authorize(request, "PUT", "upload-chunk", uploadId);
    if (!/^(?:0|[1-9]\d?)$/.test(index ?? "") || Number(index) >= 64) throw httpError(400, "INVALID_PARAM", "分片序号无效");
    if (!/^application\/octet-stream(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw httpError(415, "INVALID_PARAM", "分片类型无效");
    const bytes = await readLimitedBody(request, STUDIO_UPLOAD_CHUNK_BYTES, 15_000);
    return Response.json(await writeStudioUploadChunk(owner, uploadId, Number(index), bytes), { headers });
  } catch (error) { return failure(error); }
}
export async function studioUploadCompleteAction(request: Request, id: string | undefined): Promise<Response> {
  try {
    const uploadId = validId(id);
    const owner = await authorize(request, "POST", "upload-complete", uploadId);
    await readLimitedBody(request, 0);
    return Response.json(await completeStudioUpload(owner, uploadId, request.signal), { headers });
  } catch (error) { return failure(error); }
}
