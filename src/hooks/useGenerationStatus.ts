import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import type { GenerateStatusResponse } from "../contracts/generate";
import { mockGetStatus } from "../mocks/api";

// job 态短轮询（docs/dev 08 §9.3）：每 2s 轮询，终态停、满 5min 兜底停。
// 阶段二把 queryFn 换成真 fetch(/api/generate-status?id=)，hook 不变。
export function useGenerationStatus(generationId: string | null) {
  // 每个 generationId 独立计 5min 兜底起点（id 变即重置）。
  const clock = useRef<{ id: string | null; t: number }>({ id: generationId, t: Date.now() });
  if (clock.current.id !== generationId) clock.current = { id: generationId, t: Date.now() };

  return useQuery<GenerateStatusResponse>({
    queryKey: ["generation", generationId],
    enabled: !!generationId,
    queryFn: () => mockGetStatus(generationId as string),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "succeeded" || s === "failed") return false; // 终态停轮询
      if (Date.now() - clock.current.t > 5 * 60_000) return false; // 满 5min 前端兜底（§5.5）
      return 2_000; // 每 2s
    },
    // 生成进行中即使标签页切到后台也继续轮询，结果一就绪即落地（比示例的 false 更贴合「提交后切走等结果」体验）。
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}
