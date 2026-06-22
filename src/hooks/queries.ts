// 客户端读 hooks（08 §9.3）。loader 取首屏 → 同 query key 作 initialData（无 SSR/CSR 抖动）；
// 兑换/生成/删除成功后 invalidate 对应 key 自动刷新。所有 queryFn 走同源 cookie + Zod 解析（api-client）。
import { useQuery } from "@tanstack/react-query";
import { useRouteLoaderData } from "react-router";
import type { loader as appLoader } from "../../app/routes/_app";
import { ConversationDetail, ConversationListResponse } from "../contracts/conversation";
import { type ImageRange, ImagesResponse } from "../contracts/image";
import { InspirationsResponse } from "../contracts/inspiration";
import { MeResponse } from "../contracts/me";
import { NotificationListResponse } from "../contracts/notification";
import { PackagesResponse } from "../contracts/package";
import { apiGet } from "../lib/api-client";

/** _app 父 loader 数据（me + 会话列表首屏），供子组件作 query initialData。 */
function useAppLoaderData() {
  return useRouteLoaderData<typeof appLoader>("routes/_app");
}

export function useMe() {
  const app = useAppLoaderData();
  return useQuery({
    queryKey: ["me", "balance"],
    queryFn: () => apiGet("/api/me", MeResponse),
    initialData: app?.me,
  });
}

export function useConversations() {
  const app = useAppLoaderData();
  return useQuery({
    queryKey: ["conversations"],
    queryFn: () => apiGet("/api/conversations", ConversationListResponse),
    initialData: app?.conversations,
  });
}

export function useConversationDetail(id: string | null, initialData?: ConversationDetail) {
  return useQuery({
    queryKey: ["conversation", id],
    enabled: !!id,
    queryFn: () => apiGet(`/api/conversations/${id}`, ConversationDetail),
    initialData,
  });
}

export interface AssetsQuery {
  range?: ImageRange;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function assetsUrl(q: AssetsQuery): string {
  const p = new URLSearchParams();
  if (q.range) p.set("range", q.range);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.page) p.set("page", String(q.page));
  if (q.pageSize) p.set("pageSize", String(q.pageSize));
  const s = p.toString();
  return s ? `/api/images?${s}` : "/api/images";
}

export function useAssets(query: AssetsQuery, initialData?: ImagesResponse, enabled = true) {
  return useQuery({
    queryKey: ["assets", query],
    queryFn: () => apiGet(assetsUrl(query), ImagesResponse),
    initialData,
    enabled,
  });
}

export function usePackages(initialData?: PackagesResponse) {
  return useQuery({
    queryKey: ["packages"],
    queryFn: () => apiGet("/api/packages", PackagesResponse),
    initialData,
  });
}

export function useInspirations(category: string, q: string, initialData?: InspirationsResponse) {
  const p = new URLSearchParams();
  if (category && category !== "全部") p.set("category", category);
  if (q.trim()) p.set("q", q.trim());
  const s = p.toString();
  return useQuery({
    queryKey: ["inspiration", { category, q }],
    queryFn: () => apiGet(s ? `/api/inspirations?${s}` : "/api/inspirations", InspirationsResponse),
    initialData,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet("/api/notifications?unread=1", NotificationListResponse),
    // 顶栏铃铛不入 SSR loader（08 §9.2）；进入即拉一次。
    staleTime: 30_000,
  });
}
