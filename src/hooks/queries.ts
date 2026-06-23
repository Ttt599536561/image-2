// 客户端读 hooks（08 §9.3）。loader 取首屏 → 同 query key 作 initialData（无 SSR/CSR 抖动）；
// 兑换/生成/删除成功后 invalidate 对应 key 自动刷新。所有 queryFn 走同源 cookie + Zod 解析（api-client）。
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouteLoaderData } from "react-router";
import type { loader as appLoader } from "../../app/routes/_app";
import { LedgerResponse, LotsResponse, RedemptionsResponse } from "../contracts/account";
import { ConversationDetail, ConversationListResponse } from "../contracts/conversation";
import { type ImageRange, ImagesResponse } from "../contracts/image";
import { InspirationsResponse } from "../contracts/inspiration";
import { MySubmissionsResponse } from "../contracts/inspirationSubmission";
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

export function useConversations(q?: string) {
  const app = useAppLoaderData();
  const search = q?.trim() || undefined; // P3-S2 标题搜索（空=完整列表，用 loader initialData）
  return useQuery({
    queryKey: ["conversations", search ?? null],
    queryFn: () =>
      apiGet(search ? `/api/conversations?q=${encodeURIComponent(search)}` : "/api/conversations", ConversationListResponse),
    initialData: search ? undefined : app?.conversations,
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
  q?: string;
  page?: number;
  pageSize?: number;
}

function assetsUrl(query: AssetsQuery): string {
  const p = new URLSearchParams();
  if (query.range) p.set("range", query.range);
  if (query.from) p.set("from", query.from);
  if (query.to) p.set("to", query.to);
  if (query.q) p.set("q", query.q);
  if (query.page) p.set("page", String(query.page));
  if (query.pageSize) p.set("pageSize", String(query.pageSize));
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

// P3-S4：category/q 服务端过滤（与 S2 同范式，debounce 在调用方）。queryKey 含 category+q；
// 默认视图（全部 + 无搜索）用 loader initialData 免抖；筛选时走网络但 keepPreviousData 避免空屏闪。
export function useInspirations(category: string, q: string, initialData?: InspirationsResponse) {
  const cat = category && category !== "全部" ? category : "";
  const needle = q.trim();
  const p = new URLSearchParams();
  if (cat) p.set("category", cat);
  if (needle) p.set("q", needle);
  const s = p.toString();
  const isDefault = !cat && !needle;
  return useQuery({
    queryKey: ["inspiration", { category: cat || "全部", q: needle }],
    queryFn: () => apiGet(s ? `/api/inspirations?${s}` : "/api/inspirations", InspirationsResponse),
    initialData: isDefault ? initialData : undefined,
    placeholderData: keepPreviousData,
  });
}

// #8 账号页：积分批次 / 流水（可按类型筛）/ 兑换记录。均 owner-scoped server 读，无 SSR initialData（次级页按需拉）。
export function useLots() {
  return useQuery({
    queryKey: ["lots"],
    queryFn: () => apiGet("/api/account/lots", LotsResponse),
  });
}

export function useLedger(type: string) {
  const t = type && type !== "all" ? type : "";
  return useQuery({
    queryKey: ["ledger", t || "all"],
    queryFn: () => apiGet(t ? `/api/account/ledger?type=${t}` : "/api/account/ledger", LedgerResponse),
    placeholderData: keepPreviousData,
  });
}

export function useRedemptions() {
  return useQuery({
    queryKey: ["redemptions"],
    queryFn: () => apiGet("/api/account/redemptions", RedemptionsResponse),
  });
}

// §13.1 我的灵感投稿（弹窗内查审核状态）。owner-scoped，无 SSR initialData（按需拉）。
export function useMySubmissions(enabled = true) {
  return useQuery({
    queryKey: ["my-submissions"],
    queryFn: () => apiGet("/api/inspiration-submissions", MySubmissionsResponse),
    enabled,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    // ②（2026-06-22）：拉近 50 条「全部」（含已读）——看完仍保留、可反复点开；红点改由前端按 read_at 计未读。
    queryFn: () => apiGet("/api/notifications", NotificationListResponse),
    // 顶栏铃铛不入 SSR loader（08 §9.2）；进入即拉一次。
    staleTime: 30_000,
  });
}
