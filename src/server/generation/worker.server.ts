import { getSql } from "../../db/db.server";
import { runGenerationJob } from "./process";

export async function runWorkerIteration(concurrency: number): Promise<number> {
  const limit = Math.max(1, Math.min(32, Math.trunc(concurrency) || 1));
  const sql = getSql();
  const rows = (await sql`
    SELECT id FROM generations
    WHERE status='queued' AND deadline_at > now()
    ORDER BY created_at ASC
    LIMIT ${limit}`) as Array<{ id: string }>;
  await Promise.all(rows.map(({ id }) => runGenerationJob(id)));
  return rows.length;
}

export async function runWorker(signal: AbortSignal): Promise<void> {
  const concurrency = Number(process.env.WORKER_CONCURRENCY || "1");
  while (!signal.aborted) {
    const count = await runWorkerIteration(concurrency);
    if (count === 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
}
