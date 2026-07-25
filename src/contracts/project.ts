// 项目契约（F-074 侧边栏项目分组）。项目按 sort_order 升序；项目内会话按 sort_order 升序。
// 排序接口均为「整组提交 id 数组」：服务端校验必须与该用户该组现有集合完全一致后整体重写。
import { z } from "zod";

export const PROJECT_NAME_MAX = 50;

export const ProjectConversation = z.object({
  id: z.uuid(),
  title: z.string(),
  sortOrder: z.number().int(),
  updatedAt: z.string(),
});
export type ProjectConversation = z.infer<typeof ProjectConversation>;

export const ProjectListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  conversations: z.array(ProjectConversation),
});
export type ProjectListItem = z.infer<typeof ProjectListItem>;

export const ProjectListResponse = z.object({
  items: z.array(ProjectListItem),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponse>;

export const ProjectNameRequest = z.object({
  name: z.string().min(1).max(PROJECT_NAME_MAX),
});
export type ProjectNameRequest = z.infer<typeof ProjectNameRequest>;

export const ProjectMutationResponse = z.object({
  item: ProjectListItem,
});
export type ProjectMutationResponse = z.infer<typeof ProjectMutationResponse>;

export const ProjectOrderRequest = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
});
export type ProjectOrderRequest = z.infer<typeof ProjectOrderRequest>;

export const ProjectOrderResponse = z.object({
  ok: z.literal(true),
});
export type ProjectOrderResponse = z.infer<typeof ProjectOrderResponse>;
