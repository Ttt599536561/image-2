import { closeDbPools } from "../src/db/db.server";
import { runWorker } from "../src/server/generation/worker.server";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  await runWorker(controller.signal);
} finally {
  await closeDbPools();
}
