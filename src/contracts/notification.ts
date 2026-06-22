// 站内通知（07 §8.3 / §8.5）。image_expiring（图片到期前 1 天，cron 预扫产出）+ announcement（后台广播公告，§9）。
import { z } from "zod";

export const NotificationItem = z.object({
  id: z.uuid(),
  // image_expiring: {imageId, expiresAt} ｜ announcement: {title, body, link?}
  type: z.enum(["image_expiring", "announcement"]),
  payload: z.record(z.string(), z.unknown()).nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationListResponse = z.object({ items: z.array(NotificationItem) });
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;

// 标记已读：缺省 ids → 全标该用户未读。
export const MarkReadRequest = z.object({ ids: z.array(z.uuid()).optional() });
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;
