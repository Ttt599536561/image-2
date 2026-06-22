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
    // 生成进行中即使标签页切到后台也继续轮询：用户提交后常切走等结果，保持轮询让「切回即见图」而非再等一拍。
    // 这是有界短轮询（终态/5min 即停），代价小；与全局长缓存查询的「后台暂停」取舍不同，故此处保持 true。
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}
