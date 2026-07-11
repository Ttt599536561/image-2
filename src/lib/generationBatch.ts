import {
  GenerateStatusBatchResponse,
  type GenerateStatusBatchResponse as GenerateStatusBatch,
} from "../contracts/generate";
import { apiGet } from "./api-client";

export type StatusChunkLoader = (ids: string[]) => Promise<GenerateStatusBatch>;

async function loadChunk(ids: string[]): Promise<GenerateStatusBatch> {
  return apiGet(
    `/api/generate-status?ids=${encodeURIComponent(ids.join(","))}`,
    GenerateStatusBatchResponse,
  );
}

export async function loadStatusChunks(
  generationIds: string[],
  loader: StatusChunkLoader = loadChunk,
): Promise<GenerateStatusBatch> {
  const uniqueIds = [...new Set(generationIds)];
  if (uniqueIds.length === 0) return { items: [], missingIds: [] };
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 50) {
    chunks.push(uniqueIds.slice(index, index + 50));
  }
  const results = await Promise.all(chunks.map((chunk) => loader(chunk)));
  return {
    items: results.flatMap((result) => result.items),
    missingIds: results.flatMap((result) => result.missingIds),
  };
}
