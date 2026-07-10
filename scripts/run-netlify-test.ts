import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

const cli = resolve(process.cwd(), "node_modules/netlify-cli/bin/run.js");
const child = spawn(process.execPath, [cli, "dev"], {
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
