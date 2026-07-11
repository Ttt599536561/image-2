// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadGenerationStatuses: vi.fn(),
}));

vi.mock("../../src/lib/guard", () => ({ requireUser: mocks.requireUser }));
vi.mock("../../src/server/generation/status.server", async () => ({
  ...(await vi.importActual("../../src/server/generation/status.server")),
  loadGenerationStatuses: mocks.loadGenerationStatuses,
}));
vi.mock("../../src/db/db.server", () => ({
  getSql: () => {
    throw new Error("handler must use status.server");
  },
}));

import handler from "../../netlify/functions/generate-status";

const ownerId = "00000000-0000-4000-8000-000000000001";
const firstId = "00000000-0000-4000-8000-000000000002";
const secondId = "00000000-0000-4000-8000-000000000003";
const thirdId = "00000000-0000-4000-8000-000000000004";
const item = {
  generationId: firstId,
  credentialMode: "custom" as const,
  deadlineAt: "2026-07-11T00:05:00.000Z",
  status: "queued" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: ownerId });
});

describe("GET /api/generate-status", () => {
  it("rejects invalid or conflicting parameters without loading", async () => {
    const response = await handler(
      new Request(`http://localhost/api/generate-status?id=${firstId}&ids=${secondId}`),
    );
    expect(response.status).toBe(400);
    expect(mocks.loadGenerationStatuses).not.toHaveBeenCalled();
  });

  it("returns the legacy single object for one owned id", async () => {
    mocks.loadGenerationStatuses.mockResolvedValue([item]);
    const response = await handler(new Request(`http://localhost/api/generate-status?id=${firstId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(item);
    expect(mocks.loadGenerationStatuses).toHaveBeenCalledWith(ownerId, [firstId]);
  });

  it("returns the same 404 for an absent or foreign single id", async () => {
    mocks.loadGenerationStatuses.mockResolvedValue([]);
    const response = await handler(new Request(`http://localhost/api/generate-status?id=${secondId}`));
    expect(response.status).toBe(404);
  });

  it("returns owned items and ordered missing ids for a batch", async () => {
    mocks.loadGenerationStatuses.mockResolvedValue([item]);
    const response = await handler(
      new Request(`http://localhost/api/generate-status?ids=${firstId},${secondId},${thirdId}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [item], missingIds: [secondId, thirdId] });
  });
});
