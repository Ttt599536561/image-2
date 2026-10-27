// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GenerateStatusBatchResponse } from "../../contracts/generate";
import { loadGenerationStatuses, parseGenerationStatusQuery } from "./status.server";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), expire: vi.fn() }));
vi.mock("../../db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("./deadline.server", () => ({ expireDueGenerations: mocks.expire }));

describe("status query parsing", () => {
  it("returns committed image identity and library state under an owner constraint", async () => {
    const generationId = randomUUID(); const userId = randomUUID(); const imageId = randomUUID();
    mocks.sql.mockResolvedValueOnce([{
      id: generationId, credential_mode: "system", deadline_at: new Date(), status: "succeeded",
      image_id: imageId, public_url: "/media/result.png", width: 1024, height: 1024,
      saved_to_library: true, credits_charged_mp: 70, duration_ms: 5_000,
    }]);
    const [status] = await loadGenerationStatuses(userId, [generationId]);
    expect(status).toMatchObject({ status: "succeeded", image: { id: imageId, savedToLibrary: true } });
    expect(GenerateStatusBatchResponse.safeParse({ items: [status], missingIds: [] }).success).toBe(true);
    expect(mocks.sql.mock.calls[0][0].join("?")).toContain("g.user_id=");
    expect(mocks.sql.mock.calls[0].at(-1)).toBe(userId);
  });
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
