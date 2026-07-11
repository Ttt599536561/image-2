import { closeDbPools } from "../src/db/db.server";
import timeoutRescan from "../netlify/functions/cron-timeout-rescan";
import credentialCleanup from "../netlify/functions/cron-clean-generation-credentials";
import budgetCleanup from "../netlify/functions/cron-budget-cleanup";
import expireCredits from "../netlify/functions/cron-expire-credits";
import reconcileBalance from "../netlify/functions/cron-reconcile-balance";
import cleanImages from "../netlify/functions/cron-clean-images";

const completed = new Map<string, number>();
let stopping = false;

async function run(name: string, slot: string, expiresAt: number, job: () => Promise<Response>) {
  const key = `${name}:${slot}`;
  if (completed.has(key)) return;
  try {
    const response = await job();
    if (!response.ok) {
      console.error(`[scheduler] ${name} failed with ${response.status}; retrying in current slot`);
      return;
    }
    completed.set(key, expiresAt);
  } catch {
    console.error(`[scheduler] ${name} threw; retrying in current slot`);
  }
}

async function tick(now = new Date()) {
  const minuteSlot = now.toISOString().slice(0, 16);
  const nowMs = now.getTime();
  for (const [key, expiry] of completed) if (expiry <= nowMs) completed.delete(key);
  const minuteExpiry = nowMs + 2 * 60_000;
  const dayExpiry = nowMs + 2 * 24 * 60 * 60_000;
  await run("timeout-rescan", minuteSlot, minuteExpiry, timeoutRescan);
  if (now.getUTCMinutes() % 5 === 0) await run("credential-cleanup", minuteSlot, minuteExpiry, credentialCleanup);
  const hm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const day = now.toISOString().slice(0, 10);
  if (hm === "16:00") await run("budget-cleanup", day, dayExpiry, budgetCleanup);
  if (hm === "16:10") await run("expire-credits", day, dayExpiry, expireCredits);
  if (hm === "16:30") await run("reconcile-balance", day, dayExpiry, reconcileBalance);
  if (hm === "17:00") await run("clean-images", day, dayExpiry, cleanImages);
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

try {
  while (!stopping) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
} finally {
  await closeDbPools();
}
