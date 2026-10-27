// @vitest-environment node
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), subscribe: vi.fn(), sql: vi.fn(), run: vi.fn() }));
vi.mock("../../db/db.server", () => ({ getSql: () => mocks.sql }));
vi.mock("./process", () => ({ startNextGenerationJob: mocks.start, runGenerationJob: mocks.run }));
vi.mock("./notifications.server", () => ({ subscribeGenerationChanges: mocks.subscribe }));
import { runWorker } from "./worker.server";

function deferred() {
  let resolve!: (result: "succeeded") => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<"succeeded">((yes, no) => { resolve = yes; reject = no; });
  return { completion, resolve: () => resolve("succeeded"), reject };
}

describe("continuously replenished generation worker", () => {
  let controller: AbortController;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let wake: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubEnv("WORKER_CONCURRENCY", "2");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    controller = new AbortController();
    unsubscribe = vi.fn();
    mocks.subscribe.mockImplementation((listener) => { wake = listener; return unsubscribe; });
    mocks.start.mockResolvedValue(null);
    mocks.sql.mockResolvedValue([]);
  });
  afterEach(() => { controller.abort(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("starts late arrivals in empty slots and refills without waiting for the slow job", async () => {
    const a = deferred(); const b = deferred(); const c = deferred();
    mocks.start.mockResolvedValueOnce(a).mockResolvedValueOnce(null);
    const worker = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    mocks.start.mockResolvedValueOnce(b);
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.start).toHaveBeenCalledTimes(3);
    mocks.start.mockResolvedValueOnce(c);
    b.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.start).toHaveBeenCalledTimes(4);
    controller.abort();
    a.resolve(); c.resolve();
    await worker;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("caps active jobs and drains all started work on shutdown", async () => {
    const a = deferred(); const b = deferred();
    mocks.start.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    let finished = false;
    const worker = runWorker(controller.signal).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    controller.abort(); a.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    b.resolve(); await worker;
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it("uses the timed fallback to admit late jobs while an older job is still active", async () => {
    const a = deferred(); const b = deferred();
    mocks.start.mockResolvedValueOnce(a).mockResolvedValueOnce(null);
    const worker = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    mocks.start.mockResolvedValueOnce(b);
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.start).toHaveBeenCalledTimes(3);
    controller.abort(); a.resolve(); b.resolve(); await worker;
  });

  it("isolates a rejected job and immediately uses its slot", async () => {
    const a = deferred(); const b = deferred(); const c = deferred();
    mocks.start.mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(c);
    const worker = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    a.reject(new Error("secret must not be logged"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.start).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret");
    controller.abort(); b.resolve(); c.resolve(); await worker;
  });

  it("backs off database failures even during a notification burst and recovers", async () => {
    mocks.start.mockRejectedValueOnce(new Error("database unavailable"));
    const worker = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20; index++) wake();
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    controller.abort(); await worker;
  });

  it("polls without notifications and removes abort listeners after every idle wait", async () => {
    mocks.subscribe.mockImplementation(() => { throw new Error("listen unavailable"); });
    const worker = runWorker(controller.signal);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.start.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(getEventListeners(controller.signal, "abort").length).toBeLessThanOrEqual(1);
    controller.abort(); await worker;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
