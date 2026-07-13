// 生成契约（07 §8.5 / 04 §5.4）。阶段二补全为 Zod（前后端单一真相源）。
// 兼容：阶段一以纯 TS 类型消费（全部 `import type`），故 const+inferred type 同名不破坏既有 import。
import { z } from "zod";
import { PublicMediaUrlSchema } from "./public-media-url";

export const SIZES = [
  "auto",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1088x1920",
  "1920x1088",
] as const;
export type Size = (typeof SIZES)[number];

export const QUALITIES = ["auto", "high", "medium", "low"] as const;
export type Quality = (typeof QUALITIES)[number];

export const BACKGROUNDS = ["auto", "transparent", "opaque"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const CredentialModeSchema = z.enum(["system", "custom"]);
export type CredentialMode = z.infer<typeof CredentialModeSchema>;

export const GENERATE_REQUEST_ERROR_CODES = {
  CUSTOM_KEY_REQUIRED: "CUSTOM_KEY_REQUIRED",
  SYSTEM_MODE_FORBIDS_CUSTOM_KEY: "SYSTEM_MODE_FORBIDS_CUSTOM_KEY",
} as const;
export type GenerateRequestErrorCode =
  (typeof GENERATE_REQUEST_ERROR_CODES)[keyof typeof GENERATE_REQUEST_ERROR_CODES];

// 归一化失败枚举（唯一权威 04 §5.8；09 §10.5 直显）。error_code 为 text 列（无 DB CHECK），可加值不需迁移。
export const SYSTEM_ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "provider_timeout",
  "content_rejected",
  "invalid_request",
  "source_image_unavailable",
  "relay_unreachable",
  "unknown",
] as const;

export const CUSTOM_ERROR_CODES = [
  "custom_key_invalid",
  "custom_key_quota",
  "relay_rate_limited",
  "provider_timeout",
  "relay_unreachable",
  "invalid_request",
  "source_image_unavailable",
  "content_rejected",
  "invalid_response",
  "storage_failed",
  "unknown",
] as const;

export const ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "custom_key_invalid",
  "custom_key_quota",
  "relay_rate_limited",
  "provider_timeout",
  "relay_unreachable",
  "invalid_request",
  "source_image_unavailable",
  "content_rejected",
  "invalid_response",
  "storage_failed",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface GeneratedImage {
  publicUrl: string;
  width: number | null; // PNG 维度解析失败可空（与 DB images.width/height、succeeded 契约同口径）
  height: number | null;
}

export const SourceImageSummary = z.object({
  id: z.uuid(),
  publicUrl: PublicMediaUrlSchema,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type SourceImageSummary = z.infer<typeof SourceImageSummary>;

// Composer 只编辑生图参数；凭据模式在提交边界冻结并组装。
export const GenerateParamsSchema = z.object({
  prompt: z.string().min(1, "prompt 不能为空").max(4000),
  size: z.enum(SIZES),
  quality: z.enum(QUALITIES).optional(),
  background: z.enum(BACKGROUNDS).optional(),
  // 客户端可提供会话 id：新建会话用此 id（owner-safe upsert）/ 续聊传既有 id。支持"乐观立即跳转"。
  conversationId: z.uuid().optional(),
  // 客户端可提供生成 id：让乐观 turn 与服务端 generations 行同 id，轮询/对账即时对上、无闪烁。
  generationId: z.uuid().optional(),
  // ④b 图生图：参考图上传 key（来自 /api/uploads）。有值 → 管线走 /images/edits multipart。
  // 仅长度/形态校验；owner-scope（key 必须属本人 uploads/<me>/）由入队事务权威校验。
  inputImageKey: z.string().min(1).max(300).optional(),
});
export type GenerateParams = z.infer<typeof GenerateParamsSchema>;

// POST /api/generate wire 请求。旧页面缺 mode 且无 custom Key 时兼容为 system。
export const GenerateRequest = GenerateParamsSchema.extend({
  sourceImageId: z.uuid().optional(),
  credentialMode: CredentialModeSchema.optional(),
  customApiKey: z.string().trim().max(500).optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    const mode = value.credentialMode ?? "system";
    if (value.sourceImageId && value.inputImageKey) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceImageId"],
        message: "SOURCE_IMAGE_CONFLICT",
      });
    }
    if (mode === "custom" && !value.customApiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["customApiKey"],
        message: GENERATE_REQUEST_ERROR_CODES.CUSTOM_KEY_REQUIRED,
      });
    }
    if (mode === "system" && value.customApiKey !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["customApiKey"],
        message: GENERATE_REQUEST_ERROR_CODES.SYSTEM_MODE_FORBIDS_CUSTOM_KEY,
      });
    }
  })
  .transform((value) => ({ ...value, credentialMode: value.credentialMode ?? "system" }));
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export function generateRequestErrorCode(error: z.ZodError): GenerateRequestErrorCode | null {
  for (const issue of error.issues) {
    if (issue.message === GENERATE_REQUEST_ERROR_CODES.CUSTOM_KEY_REQUIRED) {
      return GENERATE_REQUEST_ERROR_CODES.CUSTOM_KEY_REQUIRED;
    }
    if (issue.message === GENERATE_REQUEST_ERROR_CODES.SYSTEM_MODE_FORBIDS_CUSTOM_KEY) {
      return GENERATE_REQUEST_ERROR_CODES.SYSTEM_MODE_FORBIDS_CUSTOM_KEY;
    }
  }
  return null;
}

const statusIdentity = {
  generationId: z.uuid(),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.iso.datetime(),
  sourceImageId: z.uuid().nullable(),
  sourceImage: SourceImageSummary.nullable(),
};

export const GenerateStatusResponse = z.discriminatedUnion("status", [
  z.object({
    ...statusIdentity,
    status: z.enum(["queued", "claimed", "running"]),
    startedAt: z.iso.datetime().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("succeeded"),
    image: z.object({
      publicUrl: PublicMediaUrlSchema,
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
    creditsChargedMp: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...statusIdentity,
    status: z.literal("failed"),
    errorCode: z.enum(ERROR_CODES),
    error: z.string(),
    httpStatus: z.number().int().nullable(),
    creditsChargedMp: z.literal(0),
  }),
]);
export type GenerateStatusResponse = z.infer<typeof GenerateStatusResponse>;

export const GenerateStatusBatchResponse = z.object({
  items: z.array(GenerateStatusResponse).max(50),
  missingIds: z.array(z.uuid()).max(50),
});
export type GenerateStatusBatchResponse = z.infer<typeof GenerateStatusBatchResponse>;

// POST /api/generate 入队成功（202）。conversationId：首次提交在 "/" 入队后服务端建会话，
// 前端据此 navigate(/c/:id)（08 §9.2「首次提交成功后服务端建 conversation 并 navigate」）。
export const GenerateAcceptedResponse = z.object({
  generationId: z.uuid(),
  conversationId: z.uuid(),
  status: z.literal("queued"),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.iso.datetime(),
});
export type GenerateAccepted = z.infer<typeof GenerateAcceptedResponse>;
