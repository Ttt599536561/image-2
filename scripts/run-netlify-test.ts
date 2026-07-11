import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolveAvailability) => {
    const server = createServer();
    server.once("error", () => resolveAvailability(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

const cli = resolve(process.cwd(), "node_modules/netlify-cli/bin/run.js");
if (!(await isPortAvailable(5173))) {
  console.error(
    "[test-env] port 5173 is required by Netlify auto integration; use npm run dev:ui:test for stubbed UI E2E",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [cli, "dev", "--no-open", "--offline-env"], {
  env: process.env,
  stdio: "inherit",
});

child.once("error", () => {
  console.error("[test-env] unable to start the local Netlify test server");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
