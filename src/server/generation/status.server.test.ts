// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GenerateStatusBatchResponse } from "../../contracts/generate";
import { parseGenerationStatusQuery } from "./status.server";

describe("status query parsing", () => {
  it("keeps single-id compatibility and deduplicates a batch", () => {
    const first = randomUUID();
    const second = randomUUID();
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?id=${first}`)).toEqual({
      ok: true,
      single: true,
      ids: [first],
    });
    expect(
      parseGenerationStatusQuery(
        `https://site.test/api/generate-status?ids=${first},${first},${second}`,
      ),
    ).toEqual({ ok: true, single: false, ids: [first, second] });
  });

  it("keeps missing ids explicit without distinguishing absent from foreign", () => {
    const id = randomUUID();
    expect(GenerateStatusBatchResponse.parse({ items: [], missingIds: [id] }).missingIds).toEqual([id]);
  });

  it("rejects both parameters, malformed UUIDs, and more than 50 ids", () => {
    const ids = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect(
      parseGenerationStatusQuery(
        `https://site.test/api/generate-status?id=${randomUUID()}&ids=${randomUUID()}`,
      ).ok,
    ).toBe(false);
    expect(parseGenerationStatusQuery("https://site.test/api/generate-status?ids=not-a-uuid").ok).toBe(false);
    expect(parseGenerationStatusQuery(`https://site.test/api/generate-status?ids=${ids}`).ok).toBe(false);
  });
});
