import { z } from "zod";
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from "./upload";

export const STUDIO_UPLOAD_CHUNK_BYTES = 64 * 1024;
export const STUDIO_UPLOAD_TTL_MS = 10 * 60 * 1000;
export const StudioUploadCreateRequest = z.strictObject({
  uploadId: z.uuid(),
  size: z.number().int().min(1).max(UPLOAD_MAX_BYTES),
  mime: z.enum(UPLOAD_ACCEPT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type StudioUploadCreateRequest = z.infer<typeof StudioUploadCreateRequest>;
export const StudioUploadSession = z.strictObject({
  uploadId: z.uuid(),
  chunkSize: z.literal(STUDIO_UPLOAD_CHUNK_BYTES),
  nextIndex: z.number().int().min(0).max(64),
  expiresAt: z.iso.datetime(),
  inputImageKey: z.string().min(1).max(300).optional(),
});
export type StudioUploadSession = z.infer<typeof StudioUploadSession>;
export const StudioUploadChunkResult = z.strictObject({ nextIndex: z.number().int().min(0).max(64) });
export type StudioUploadChunkResult = z.infer<typeof StudioUploadChunkResult>;
export const StudioUploadCompleteResult = z.strictObject({ inputImageKey: z.string().min(1).max(300) });
export type StudioUploadCompleteResult = z.infer<typeof StudioUploadCompleteResult>;
