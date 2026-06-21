// 站内通知（07 §8.3 / §8.5）。目前仅 image_expiring（图片到期前 1 天，cron 预扫产出）。
import { z } from "zod";

export const NotificationItem = z.object({
  id: z.uuid(),
  type: z.enum(["image_expiring"]), // 后续新增类型在此扩枚举
  payload: z.record(z.string(), z.unknown()).nullable(), // image_expiring: { imageId, expiresAt }
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationListResponse = z.object({ items: z.array(NotificationItem) });
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;

// 标记已读：缺省 ids → 全标该用户未读。
export const MarkReadRequest = z.object({ ids: z.array(z.uuid()).optional() });
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;
