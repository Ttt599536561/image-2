import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GenerateStatusBatchResponse } from "../contracts/generate";
import { loadStatusChunks } from "../lib/generationBatch";
import { mergeGenerationStatusBatch } from "../lib/generationStatusCache";

export function useGenerationStatuses(generationIds: string[]) {
  const key = [...new Set(generationIds)].sort().join(",");
  const ids = key ? key.split(",") : [];
  const qc = useQueryClient();
  const [connectedKey, setConnectedKey] = useState<string | null>(null);
  const query = useQuery<GenerateStatusBatchResponse>({
    queryKey: ["generation-statuses", key],
    enabled: ids.length > 0,
    queryFn: () => loadStatusChunks(ids),
    structuralSharing: (old, incoming) => mergeGenerationStatusBatch(
      old as GenerateStatusBatchResponse | undefined, incoming as GenerateStatusBatchResponse, ids,
    ),
    refetchInterval: (query) => {
      if (ids.length === 0) return false;
      const data = query.state.data;
      const allTerminal =
        data !== undefined &&
        data.missingIds.length === 0 &&
        data.items.length === ids.length &&
        data.items.every((item) => item.status === "succeeded" || item.status === "failed");
      return allTerminal || connectedKey === key ? false : 2_000;
    },
    refetchIntervalInBackground: true,
    gcTime: 0,
  });

  useEffect(() => {
    if (!key || key.split(",").length > 50 || typeof EventSource === "undefined") return;
    let disposed = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/generate-events?ids=${encodeURIComponent(key)}`);
    const onStatus = (event: Event) => {
      if (disposed) return;
      try {
        const result = GenerateStatusBatchResponse.safeParse(JSON.parse((event as MessageEvent).data));
        if (!result.success) return;
        qc.setQueryData<GenerateStatusBatchResponse>(["generation-statuses", key], (old) =>
          mergeGenerationStatusBatch(old, result.data, key.split(",")),
        );
        setConnectedKey(key);
        if (watchdog) clearTimeout(watchdog);
        // Two missed server snapshots indicate a silent proxy/network failure.
        watchdog = setTimeout(() => { if (!disposed) setConnectedKey(null); }, 35_000);
      } catch { /* Malformed events never replace the polling result. */ }
    };
    source.addEventListener("status", onStatus);
    source.onerror = () => { if (!disposed) setConnectedKey(null); };
    // Native EventSource owns reconnection; rendering/errors never create peers.
    return () => {
      disposed = true;
      source.removeEventListener("status", onStatus);
      source.close();
      if (watchdog) clearTimeout(watchdog);
      setConnectedKey(null);
    };
  }, [key, qc]);
  return query;
}
