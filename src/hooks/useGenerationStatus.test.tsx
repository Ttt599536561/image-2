import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationStatuses } from "./useGenerationStatus";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/generationBatch", () => ({ loadStatusChunks: mocks.load }));
const id = "00000000-0000-4000-8000-000000000001";
const identity = { generationId: id, credentialMode: "custom", deadlineAt: "2026-10-27T12:00:00.000Z", sourceImageId: null, sourceImage: null };
const success = { ...identity, status: "succeeded", creditsChargedMp: 0, durationMs: 123, image: { id, publicUrl: "/media/result.png", width: 1024, height: 1024, savedToLibrary: false } };
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { super(); FakeEventSource.instances.push(this); }
  status(data: unknown) { this.dispatchEvent(new MessageEvent("status", { data: JSON.stringify(data) })); }
}
function setup(ids = [id]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ generationIds }) => useGenerationStatuses(generationIds), { initialProps: { generationIds: ids }, wrapper }) };
}
describe("generation status events with polling recovery", () => {
  beforeEach(() => {
    mocks.load.mockReset().mockResolvedValue({ items: [{ ...identity, status: "queued" }], missingIds: [] });
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("merges SSE immediately and prevents a late poll from overwriting completion", async () => {
    let resolve!: (value: unknown) => void;
    mocks.load.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result, unmount } = setup();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0].status({ items: [success], missingIds: [] }));
    await waitFor(() => expect(result.current.data?.items[0].status).toBe("succeeded"));
    await act(async () => resolve({ items: [{ ...identity, status: "queued" }], missingIds: [] }));
    await waitFor(() => expect(result.current.data?.items[0].status).toBe("succeeded"));
    unmount(); expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce();
  });
  it("keeps one connection through errors/rerenders and resumes two-second polling", async () => {
    const { rerender, unmount } = setup();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    act(() => FakeEventSource.instances[0].status({ items: [{ ...identity, status: "running" }], missingIds: [] }));
    rerender({ generationIds: [id, id] });
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.useFakeTimers();
    act(() => FakeEventSource.instances[0].onerror?.());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(mocks.load.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(FakeEventSource.instances).toHaveLength(1);
    unmount();
  });
  it("does not create an idle connection and works when EventSource is unavailable", async () => {
    const empty = setup([]); expect(FakeEventSource.instances).toHaveLength(0); empty.unmount();
    vi.stubGlobal("EventSource", undefined);
    const fallback = setup();
    await waitFor(() => expect(fallback.result.current.data?.items[0].status).toBe("queued"));
    fallback.unmount();
  });
  it("resumes polling when a silent connection stops delivering recovery snapshots", async () => {
    const { unmount } = setup();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    act(() => FakeEventSource.instances[0].status({ items: [{ ...identity, status: "running" }], missingIds: [] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
    expect(mocks.load.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(FakeEventSource.instances).toHaveLength(1);
    unmount();
  });
});
