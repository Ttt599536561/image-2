import { subscribeGenerationChanges } from "./notifications.server";
import { startNextGenerationJob } from "./process";

function warn(stage: string): void {
  // Diagnostics must not leak upstream errors or affect queue processing.
  try { console.warn(`[worker] ${stage}`); } catch { /* monitoring is best effort */ }
}

export async function runWorker(signal: AbortSignal): Promise<void> {
  const concurrency = Math.max(1, Math.min(32, Math.trunc(Number(process.env.WORKER_CONCURRENCY || "10")) || 1));
  const active = new Set<Promise<void>>();
  let wakeWaiter: (() => void) | undefined;
  let version = 0;
  const wake = () => { version++; wakeWaiter?.(); };
  let unsubscribe = () => {};
  try { unsubscribe = subscribeGenerationChanges(wake, wake); } catch { warn("notifications_unavailable"); }

  const wait = (ms: number, interruptible: boolean, observed: number) => new Promise<void>((resolve) => {
    if (signal.aborted || (interruptible && version !== observed)) { resolve(); return; }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      if (wakeWaiter === done) wakeWaiter = undefined;
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (interruptible) wakeWaiter = done;
    signal.addEventListener("abort", done, { once: true });
  });

  let failures = 0;
  try {
    while (!signal.aborted) {
      const observed = version;
      let backoff = 0;
      while (!signal.aborted && active.size < concurrency) {
        try {
          const started = await startNextGenerationJob();
          failures = 0;
          if (!started) break;
          const job = started.completion.catch(() => { warn("job_failed"); }).then(() => {
            active.delete(job);
            wake();
          });
          active.add(job);
        } catch {
          backoff = Math.min(5_000, 500 * 2 ** Math.min(failures++, 4));
          warn("claim_failed");
          break;
        }
      }
      // Completion/NOTIFY can refill immediately; timed scans recover missed notifications.
      // Database error backoff ignores wake bursts, while shutdown always interrupts it.
      if (!signal.aborted) await wait(backoff || 500, backoff === 0, observed);
    }
  } finally {
    try { unsubscribe(); } catch { warn("unsubscribe_failed"); }
    await Promise.allSettled(active);
  }
}
