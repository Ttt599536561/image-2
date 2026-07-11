import { useQuery } from "@tanstack/react-query";
import type { GenerateStatusBatchResponse } from "../contracts/generate";
import { loadStatusChunks } from "../lib/generationBatch";

export function useGenerationStatuses(generationIds: string[]) {
  const ids = [...new Set(generationIds)];
  const key = ids.join(",");
  return useQuery<GenerateStatusBatchResponse>({
    queryKey: ["generation-statuses", key],
    enabled: ids.length > 0,
    queryFn: () => loadStatusChunks(ids),
    refetchInterval: (query) => {
      if (ids.length === 0) return false;
      const data = query.state.data;
      const allTerminal =
        data !== undefined &&
        data.missingIds.length === 0 &&
        data.items.length === ids.length &&
        data.items.every((item) => item.status === "succeeded" || item.status === "failed");
      return allTerminal ? false : 2_000;
    },
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
}
