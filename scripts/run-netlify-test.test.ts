// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNetlifyDevArgs,
  clearGeneratedDevArtifacts,
  findAvailableTargetPort,
} from "./run-netlify-test";

describe("guarded local Netlify launcher", () => {
  it("passes one explicit target port to both the app command and Netlify proxy", () => {
    expect(buildNetlifyDevArgs(5190)).toEqual([
      "dev",
      "--no-open",
      "--offline-env",
      "--command",
      "npm run dev -- --port 5190 --strictPort",
      "--target-port",
      "5190",
    ]);
  });

  it("selects the first available target without depending on port 5173", async () => {
    const checked: number[] = [];
    const selected = await findAvailableTargetPort(5174, 5, async (port) => {
      checked.push(port);
      return port === 5176;
    });

    expect(selected).toBe(5176);
    expect(checked).toEqual([5174, 5175, 5176]);
  });

  it("fails closed when no target port is available", async () => {
    await expect(findAvailableTargetPort(5174, 2, async () => false)).rejects.toThrow(
      "no local React Router target port is available",
    );
  });

  it("clears stale build/function bundles without deleting local Netlify data", () => {
    const directory = mkdtempSync(join(tmpdir(), "key-mode-netlify-artifacts-"));
    const build = join(directory, "build");
    const functions = join(directory, ".netlify", "functions-serve");
    const database = join(directory, ".netlify", "db");
    mkdirSync(build, { recursive: true });
    mkdirSync(functions, { recursive: true });
    mkdirSync(database, { recursive: true });
    writeFileSync(join(build, "stale.txt"), "stale");
    writeFileSync(join(functions, "stale.txt"), "stale");
    writeFileSync(join(database, "keep.txt"), "keep");

    try {
      clearGeneratedDevArtifacts(directory);
      expect(existsSync(build)).toBe(false);
      expect(existsSync(functions)).toBe(false);
      expect(existsSync(join(database, "keep.txt"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
