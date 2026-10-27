// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), statuses: vi.fn(), unsubscribe: vi.fn(), subscribe: vi.fn(), pg: true,
}));
vi.mock("../../src/lib/guard", () => ({ requireUserStrict: mocks.auth }));
vi.mock("../../src/db/db-driver.server", () => ({ usesPgDriver: () => mocks.pg }));
vi.mock("../../src/server/generation/notifications.server", () => ({ subscribeGenerationChanges: mocks.subscribe }));
vi.mock("../../src/server/generation/status.server", async (actual) => ({
  ...await actual<object>(), loadGenerationStatuses: mocks.statuses,
}));
import { loader } from "./api.generate-events";

const generationId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const queued = { generationId, status: "queued", credentialMode: "custom", deadlineAt: "2026-10-27T12:00:00.000Z", sourceImageId: null, sourceImage: null };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const aborts: AbortController[] = [];
function request(ids = [generationId]) {
  const abort = new AbortController(); aborts.push(abort);
  return new Request(`http://localhost/api/generate-events?ids=${ids.join(",")}`, { signal: abort.signal });
}
const invoke = (req: Request) => loader({ request: req } as Parameters<typeof loader>[0]);

describe("authenticated generation event stream", () => {
  beforeEach(() => {
    vi.useFakeTimers(); mocks.auth.mockReset().mockResolvedValue({ userId });
    mocks.statuses.mockReset().mockResolvedValue([queued]);
    mocks.unsubscribe.mockReset(); mocks.subscribe.mockReset().mockReturnValue(mocks.unsubscribe); mocks.pg = true;
  });
  afterEach(() => { aborts.splice(0).forEach((abort) => abort.abort()); vi.useRealTimers(); });

  it("authenticates before subscribing and rejects invalid/unsupported requests", async () => {
    mocks.auth.mockRejectedValueOnce(new Response(null, { status: 401 }));
    expect((await invoke(request())).status).toBe(401);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect((await invoke(request(["bad-id"]))).status).toBe(400);
    mocks.pg = false;
    expect((await invoke(request())).status).toBe(503);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("sends owner-scoped initial/recovery snapshots and ignores unrelated notifications", async () => {
    const response = await invoke(request([generationId, otherId]));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    const reader = response.body!.getReader();
    await flush();
    let chunk = new TextDecoder().decode((await reader.read()).value);
    if (!chunk.includes("event: status")) chunk += new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('"missingIds":["' + otherId + '"]');
    expect(mocks.statuses).toHaveBeenCalledWith(userId, [generationId, otherId]);
    const [change, ready] = mocks.subscribe.mock.calls[0];
    change({ generationId, userId: otherId }); change({ generationId: otherId, userId: otherId });
    await flush(); expect(mocks.statuses).toHaveBeenCalledTimes(1);
    ready(); await flush(); expect(mocks.statuses).toHaveBeenCalledTimes(2);
    mocks.statuses.mockResolvedValueOnce([{ ...queued, status: "failed", creditsChargedMp: 0, errorCode: "unknown", error: "failure", httpStatus: null }]);
    change({ generationId, userId }); await flush();
    expect(mocks.statuses).toHaveBeenCalledTimes(3);
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("heartbeats, recovers missed notifications and ends for fresh authentication", async () => {
    const response = await invoke(request()); const reader = response.body!.getReader();
    await flush(); await reader.read(); await reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(": heartbeat");
    expect(mocks.statuses.mock.calls.length).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.auth).toHaveBeenCalledOnce();
  });

  it("unsubscribes on browser abort without mutating generation state", async () => {
    await invoke(request()); await flush();
    aborts.at(-1)!.abort();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.statuses).toHaveBeenCalledOnce();
  });
});
