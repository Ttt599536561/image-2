// @vitest-environment node
// Deterministic scheduling comparison only: no database, network, storage or paid provider.
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), subscribe: vi.fn() }));
vi.mock("./process", () => ({ startNextGenerationJob: mocks.start }));
vi.mock("./notifications.server", () => ({ subscribeGenerationChanges: mocks.subscribe }));
import { runWorker } from "./worker.server";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Preserves the pre-optimization worker algorithm: select one batch, await all, then rescan.
async function originalWorker(signal: AbortSignal, select: () => string[], run: (id: string) => Promise<"succeeded">) {
  while (!signal.aborted) {
    const ids = select();
    await Promise.all(ids.map(run));
    if (ids.length === 0) await sleep(500);
  }
}

async function scenario(continuous: boolean) {
  vi.setSystemTime(0);
  const controller = new AbortController();
  const queue: string[] = ["0"];
  const arrivals = new Map<string, number>([["0", 0]]);
  const waits: number[] = [];
  const endToEnd: number[] = [];
  let active = 0; let maximumActive = 0; let finished = 0; let completedAt = 0; let scans = 0;
  let wake = () => {};
  const run = async (id: string): Promise<"succeeded"> => {
    waits.push(Date.now() - arrivals.get(id)!);
    maximumActive = Math.max(maximumActive, ++active);
    await sleep(1_000);
    active--;
    endToEnd.push(Date.now() - arrivals.get(id)!);
    if (++finished === 11) { completedAt = Date.now(); controller.abort(); }
    return "succeeded";
  };
  mocks.start.mockImplementation(async () => {
    scans++;
    const id = queue.shift();
    return id === undefined ? null : { completion: run(id) };
  });
  mocks.subscribe.mockImplementation((listener) => { wake = listener; return () => {}; });
  const worker = continuous
    ? runWorker(controller.signal)
    : originalWorker(controller.signal, () => { scans++; return queue.splice(0, 10); }, run);
  setTimeout(() => {
    for (let index = 1; index <= 9; index++) { queue.push(String(index)); arrivals.set(String(index), Date.now()); }
    wake();
  }, 100);
  setTimeout(() => { queue.push("10"); arrivals.set("10", Date.now()); wake(); }, 1_050);
  await vi.advanceTimersByTimeAsync(4_000);
  await worker;
  const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
  return { jobs: finished, maximumActive, queueWaitP50Ms: percentile(waits, 0.5), queueWaitP95Ms: percentile(waits, 0.95), endToEndP50Ms: percentile(endToEnd, 0.5), endToEndP95Ms: percentile(endToEnd, 0.95), completedAtMs: completedAt, simulatedScans: scans };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("compares unchanged synthetic work at concurrency 10 before and after continuous replenishment", async () => {
  vi.useFakeTimers();
  vi.stubEnv("WORKER_CONCURRENCY", "10");
  const before = await scenario(false);
  const after = await scenario(true);
  expect(before).toMatchObject({ jobs: 11, queueWaitP95Ms: 950, completedAtMs: 3_000 });
  expect(after).toMatchObject({ jobs: 11, queueWaitP95Ms: 0, completedAtMs: 2_050, maximumActive: 10 });
  console.log(`[worker-synthetic-comparison] ${JSON.stringify({ fixedJobDurationMs: 1_000, before, after })}`);
});
