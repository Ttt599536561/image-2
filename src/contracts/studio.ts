import { z } from "zod";
import { BACKGROUNDS, QUALITIES, SIZES, type ResultImageMime } from "./generate";

export const DEFAULT_STUDIO_BASE_URL = "https://api.tangguo.xin/v1";
export const STUDIO_MODEL = "gpt-image-2";
export const STUDIO_MODELS = ["gpt-image-2.6-flare", "gpt-image-2.6", "gpt-image-2.5-sunburst", "gpt-image-2"] as const;
export type StudioModel = typeof STUDIO_MODELS[number];
export const STUDIO_OUTPUT_FORMATS = ["png", "gif"] as const;
export type StudioOutputFormat = typeof STUDIO_OUTPUT_FORMATS[number];
export function supportsGifOutput(model: string | undefined): boolean {
  return model === "gpt-image-2.6" || model === "gpt-image-2.6-flare";
}
export const MAX_STUDIO_REFERENCE_IMAGES = 4;
export const StudioGenerateRequest = z.object({
  baseUrl: z.literal(DEFAULT_STUDIO_BASE_URL).optional(),
  model: z.enum(STUDIO_MODELS).default(STUDIO_MODEL),
  outputFormat: z.enum(STUDIO_OUTPUT_FORMATS).default("png"),
  apiKey: z.string().trim().min(1).max(500).refine((s) => !/[\r\n\u0000]/.test(s), "API Key 无效"),
  prompt: z.string().trim().min(1).max(4000),
  size: z.enum(SIZES),
  quality: z.enum(QUALITIES).optional(),
  background: z.enum(BACKGROUNDS).optional(),
  generationId: z.uuid(),
  conversationId: z.uuid().optional(),
  inputImageKey: z.string().min(1).max(300).optional(),
  inputImageKeys: z.array(z.string().min(1).max(300)).min(1).max(MAX_STUDIO_REFERENCE_IMAGES).optional(),
  sourceImageId: z.uuid().optional(),
}).strict().refine((input) => [input.inputImageKey, input.inputImageKeys, input.sourceImageId].filter((value) => value !== undefined).length <= 1, "来源图片参数冲突")
  .refine((input) => input.outputFormat !== "gif" || (supportsGifOutput(input.model) && !input.inputImageKey && !input.inputImageKeys && !input.sourceImageId && input.background !== "transparent"), "GIF 仅支持 Image 2.6 / Flare 文生图，不支持参考图或透明背景");
export type StudioGenerateRequest = z.input<typeof StudioGenerateRequest>;
export type StudioParams = Pick<StudioGenerateRequest, "prompt" | "size" | "quality" | "background" | "model" | "outputFormat">;
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
  image?: { id: string; url: string; width: number | null; height: number | null; contentType?: ResultImageMime };
  error?: { code: string; message: string };
};
export type StudioStatusBatch = { items: StudioJobStatus[]; missingIds: string[] };
export type StudioSessionInfo = {
  ok: true;
  defaults: { baseUrl: string; model: string };
  limits: { maxPromptLength: number; maxUploadBytes: number; maxInflight: number; maxReferenceImages: number };
};
