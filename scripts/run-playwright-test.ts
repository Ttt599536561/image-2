import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

const cli = resolve(process.cwd(), "node_modules/@playwright/test/cli.js");
const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

child.once("error", () => {
  console.error("[test-env] unable to start the Playwright test runner");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
