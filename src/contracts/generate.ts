// 生成契约（07 §8.5 / 04 §5.4）。阶段二补全为 Zod（前后端单一真相源）。
// 兼容：阶段一以纯 TS 类型消费（全部 `import type`），故 const+inferred type 同名不破坏既有 import。
import { z } from "zod";

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
export const ERROR_CODES = [
  "insufficient_quota",
  "relay_5xx",
  "provider_timeout",
  "content_rejected",
  "invalid_request", // 参数错误（尺寸/格式/无效请求，中转 400 类），#5 友好中文映射
  "relay_unreachable",
  "unknown",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface GeneratedImage {
  publicUrl: string;
  width: number | null; // PNG 维度解析失败可空（与 DB images.width/height、succeeded 契约同口径）
  height: number | null;
}

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
  credentialMode: CredentialModeSchema.optional(),
  customApiKey: z.string().trim().max(500).optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    const mode = value.credentialMode ?? "system";
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

// 按 status 的判别联合（与 04 §5.4 逐字段一致）：进行中无 creditsChargedMp，succeeded/failed 字段各异。
export const GenerateStatusResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["queued", "claimed", "running"]),
    startedAt: z.string().optional(),
    elapsedMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    status: z.literal("succeeded"),
    // width/height 可空：PNG 头解析失败时 images.width/height 为 NULL（02 §3.2 / 06 §7.3 readPngDims 可选），
    // 与 DB 列及 image.ts/conversation.ts 同口径，避免成功行因维度缺失 .parse() 失败。
    image: z.object({
      publicUrl: z.url(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    }),
    creditsChargedMp: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal("failed"),
    errorCode: z.enum(ERROR_CODES),
    error: z.string(), // 脱敏可读串（可含状态码原文）
    httpStatus: z.number().int().nullable(), // 中转 HTTP 状态码，无则 null
  }),
]);
export type GenerateStatusResponse = z.infer<typeof GenerateStatusResponse>;

// POST /api/generate 入队成功（202）。conversationId：首次提交在 "/" 入队后服务端建会话，
// 前端据此 navigate(/c/:id)（08 §9.2「首次提交成功后服务端建 conversation 并 navigate」）。
export const GenerateAcceptedResponse = z.object({
  generationId: z.uuid(),
  conversationId: z.uuid(),
  status: z.literal("queued"),
});
export interface GenerateAccepted {
  generationId: string;
  conversationId: string;
  status: "queued";
}
