import { z } from "zod";
import { BACKGROUNDS, QUALITIES, SIZES } from "./generate";

export const DEFAULT_STUDIO_BASE_URL = "https://api.tangguo.xin/v1";
export const STUDIO_MODEL = "gpt-image-2";
export const StudioGenerateRequest = z.object({
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().min(1).max(500).refine((s) => !/[\r\n\u0000]/.test(s), "API Key 无效"),
  prompt: z.string().trim().min(1).max(4000),
  size: z.enum(SIZES),
  quality: z.enum(QUALITIES).optional(),
  background: z.enum(BACKGROUNDS).optional(),
  generationId: z.uuid(),
  conversationId: z.uuid().optional(),
  inputImageKey: z.string().min(1).max(300).optional(),
  sourceImageId: z.uuid().optional(),
}).strict();
export type StudioGenerateRequest = z.infer<typeof StudioGenerateRequest>;
export type StudioParams = Pick<StudioGenerateRequest, "prompt" | "size" | "quality" | "background">;
export type StudioAccepted = {
  generationId: string;
  conversationId: string;
  status: "queued";
  deadlineAt: string;
};
export type StudioJobStatus = {
  generationId: string;
  status: "queued" | "claimed" | "running" | "succeeded" | "failed";
  deadlineAt: string;
  startedAt?: string;
  elapsedMs?: number;
  durationMs?: number;
  image?: { id: string; url: string; width: number | null; height: number | null };
  error?: { code: string; message: string };
};
export type StudioStatusBatch = { items: StudioJobStatus[]; missingIds: string[] };
export type StudioSessionInfo = {
  ok: true;
  defaults: { baseUrl: string; model: string };
  limits: { maxPromptLength: number; maxUploadBytes: number; maxInflight: number };
};
