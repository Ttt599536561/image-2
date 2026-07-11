import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadDisposableTestEnv } from "./test-env-guard";

loadDisposableTestEnv();

const cli = resolve(process.cwd(), "node_modules/@react-router/dev/bin.cjs");
const child = spawn(process.execPath, [cli, "dev", "--port", "8888", "--strictPort"], {
  env: process.env,
  stdio: "inherit",
});

child.once("error", () => {
  console.error("[test-env] unable to start the local UI test server");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
