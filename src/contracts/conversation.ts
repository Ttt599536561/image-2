// 会话契约（07 §8.3）。列表（分页倒序）+ 详情（含 generations 正序、含图/态）+ 改名。
import { z } from "zod";
import { CredentialModeSchema, ERROR_CODES, SourceImageSummary } from "./generate";
import { PublicMediaUrlSchema } from "./public-media-url";

export const ConversationListItem = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.string(),
});
export type ConversationListItem = z.infer<typeof ConversationListItem>;

export const ConversationListResponse = z.object({
  items: z.array(ConversationListItem),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponse>;

// 详情里的一轮生成（generations 行 + 可选 images 行）。
export const ConversationGeneration = z.object({
  id: z.uuid(),
  prompt: z.string(),
  size: z.string(),
  quality: z.string().nullable(),
  background: z.string().nullable(),
  credentialMode: CredentialModeSchema,
  deadlineAt: z.iso.datetime(),
  sourceImageId: z.uuid().nullable(),
  sourceImage: SourceImageSummary.nullable(),
  status: z.enum(["queued", "claimed", "running", "succeeded", "failed"]),
  errorCode: z.enum(ERROR_CODES).nullable(),
  error: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  creditsChargedMp: z.number().int(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  image: z
    .object({
      id: z.uuid(),
      publicUrl: PublicMediaUrlSchema,
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      savedToLibrary: z.boolean(), // 「存入资产库」按钮置灰依据（08 §9.4）
    })
    .nullable(),
});
export type ConversationGeneration = z.infer<typeof ConversationGeneration>;

export const ConversationDetail = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  generations: z.array(ConversationGeneration), // 按时间正序
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

// §10 重命名会话（owner-scoped，即时持久化）。前端空标题拦截 + 后端 trim 兜底。
export const RenameRequest = z.object({ title: z.string().min(1).max(200) });
export type RenameRequest = z.infer<typeof RenameRequest>;

export const ConversationRenameResponse = z.object({ id: z.uuid(), title: z.string() });
export type ConversationRenameResponse = z.infer<typeof ConversationRenameResponse>;

// #3 删除会话（owner-scoped，不可恢复；级联 generations→images + 尽力删 R2）。
export const ConversationDeleteResponse = z.object({ deleted: z.number().int() });
export type ConversationDeleteResponse = z.infer<typeof ConversationDeleteResponse>;
