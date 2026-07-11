import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDisposableTestEnv } from "./test-env-guard";

export function buildFullLocalDevArgs(): string[] {
  return ["dev", "--port", "8888", "--strictPort"];
}

async function runCli(): Promise<void> {
  loadDisposableTestEnv();
  process.env.LOCAL_TEST_STORAGE_ROOT ||= resolve(process.cwd(), ".local-test-storage");
  const cli = resolve(process.cwd(), "node_modules/@react-router/dev/bin.cjs");
  const child = spawn(process.execPath, [cli, ...buildFullLocalDevArgs()], {
    env: process.env,
    stdio: "inherit",
  });

  child.once("error", () => {
    console.error("[test-env] unable to start the disposable test server");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  await runCli();
}
