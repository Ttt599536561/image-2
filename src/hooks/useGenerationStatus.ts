import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { GenerateStatusResponse } from "../contracts/generate";
import { apiGet } from "../lib/api-client";

// job 态短轮询（docs/dev 08 §9.3）：每 2s 轮询，终态停、满 5min 兜底停。
// ⑤ 接真：queryFn → GET /api/generate-status?id=（owner-scoped 判别联合三态，hook 不变）。
export function useGenerationStatus(generationId: string | null) {
  // 每个 generationId 独立计 5min 兜底起点（id 变即重置）。
  const clock = useRef<{ id: string | null; t: number }>({ id: generationId, t: Date.now() });
  if (clock.current.id !== generationId) clock.current = { id: generationId, t: Date.now() };

  return useQuery<GenerateStatusResponse>({
    queryKey: ["generation", generationId],
    enabled: !!generationId,
    queryFn: () => apiGet(`/api/generate-status?id=${generationId}`, GenerateStatusResponse),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "succeeded" || s === "failed") return false; // 终态停轮询
      if (Date.now() - clock.current.t > 5 * 60_000) return false; // 满 5min 前端兜底（§5.5）
      return 2_000; // 每 2s
    },
    // ⚡ 标签页切到后台时暂停轮询（默认 false）：后台函数仍在服务端跑完落库，用户切回时 TanStack Query
    // 自动立即 refetch 拿到终态——无需在不可见时持续跨境拉 /api/generate-status，省流量/电池且不抢占点击请求。
    refetchIntervalInBackground: false,
    gcTime: 0,
  });
}
