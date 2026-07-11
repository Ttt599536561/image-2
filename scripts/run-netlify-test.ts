import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDisposableTestEnv } from "./test-env-guard";

export async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolveAvailability) => {
    const server = createServer();
    server.once("error", () => resolveAvailability(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveAvailability(true));
    });
  });
}

export async function findAvailableTargetPort(
  startPort = 5174,
  attempts = 20,
  check = isPortAvailable,
): Promise<number> {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    if (await check(port)) return port;
  }
  throw new Error("[test-env] no local React Router target port is available");
}

export function buildNetlifyDevArgs(targetPort: number): string[] {
  return [
    "dev",
    "--no-open",
    "--offline-env",
    "--command",
    `npm run dev -- --port ${targetPort} --strictPort`,
    "--target-port",
    String(targetPort),
  ];
}

export function clearGeneratedDevArtifacts(cwd = process.cwd()): void {
  const workspace = resolve(cwd);
  for (const relativePath of ["build", ".netlify/functions-serve"]) {
    const target = resolve(workspace, relativePath);
    const pathFromWorkspace = relative(workspace, target);
    if (!pathFromWorkspace || pathFromWorkspace.startsWith("..") || isAbsolute(pathFromWorkspace)) {
      throw new Error("[test-env] refusing to clear generated files outside the workspace");
    }
    rmSync(target, { recursive: true, force: true });
  }
}

async function runCli(): Promise<void> {
  loadDisposableTestEnv();
  clearGeneratedDevArtifacts();
  process.env.LOCAL_TEST_STORAGE_ROOT ||= resolve(process.cwd(), ".netlify/local-storage");
  const targetPort = await findAvailableTargetPort();
  const cli = resolve(process.cwd(), "node_modules/netlify-cli/bin/run.js");
  const child = spawn(process.execPath, [cli, ...buildNetlifyDevArgs(targetPort)], {
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
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryPath === import.meta.url) {
  await runCli();
}
