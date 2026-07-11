import { describe, expect, it, vi } from "vitest";
import type { GenerateStatusBatchResponse } from "../contracts/generate";
import { loadStatusChunks } from "./generationBatch";

function id(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

describe("loadStatusChunks", () => {
  it("splits arbitrary ids into batches of 50 and merges items and missing ids", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => id(index + 1));
    const load = vi.fn(async (chunk: string[]): Promise<GenerateStatusBatchResponse> => ({
      items: chunk.slice(0, 1).map((generationId) => ({
        generationId,
        credentialMode: "custom",
        deadlineAt: "2026-07-11T00:05:00.000Z",
        status: "queued",
      })),
      missingIds: chunk.slice(1),
    }));

    const result = await loadStatusChunks(ids, load);

    expect(load).toHaveBeenCalledTimes(3);
    expect(load.mock.calls.map(([chunk]) => chunk.length)).toEqual([50, 50, 1]);
    expect(result.items).toHaveLength(3);
    expect(result.missingIds).toHaveLength(98);
  });

  it("deduplicates ids and avoids a request for an empty list", async () => {
    const load = vi.fn();
    expect(await loadStatusChunks([], load)).toEqual({ items: [], missingIds: [] });
    expect(load).not.toHaveBeenCalled();
  });
});
