// 灵感库用户投稿契约（§13.1）。前后端单一真相源；🔴 客户端可达 → 手写 Zod，绝不 value-import db/schema。
import { z } from "zod";

// 防滥用上限（前端提示 + 后端权威同值）。
export const INSPIRATION_SUBMISSION_MAX_PENDING = 10; // 每用户待审上限
export const INSPIRATION_SUBMISSION_RATE_PER_WINDOW = 10; // 10 次 / 10 分钟（events 计数）

// 提交：只传 imageId（服务端按 owner-scope 取真实 key/url/宽高/原 prompt），其余文本字段用户填。
export const InspirationSubmitRequest = z.object({
  imageId: z.uuid(),
  title: z.string().min(1, "标题必填").max(100),
  prompt: z.string().min(1, "提示词必填").max(4000),
  category: z.string().max(50).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
});
export type InspirationSubmitRequest = z.infer<typeof InspirationSubmitRequest>;

export const InspirationSubmitResponse = z.object({
  id: z.uuid(),
  status: z.literal("pending"),
});
export type InspirationSubmitResponse = z.infer<typeof InspirationSubmitResponse>;

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;

// 我的投稿（弹窗内查审核状态）。image=副本公有 URL（驳回回收后可能 404，前端 onError 兜底）。
export const MySubmissionItem = z.object({
  id: z.uuid(),
  image: z.string(),
  title: z.string(),
  prompt: z.string(),
  category: z.string().nullable(),
  summary: z.string().nullable(),
  status: z.enum(SUBMISSION_STATUSES),
  reviewReason: z.string().nullable(),
  createdAt: z.string(),
});
export type MySubmissionItem = z.infer<typeof MySubmissionItem>;

export const MySubmissionsResponse = z.object({ items: z.array(MySubmissionItem) });
export type MySubmissionsResponse = z.infer<typeof MySubmissionsResponse>;
