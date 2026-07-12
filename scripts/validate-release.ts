import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import semver from "semver";

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type ReleaseValidationInput = {
  tag: string;
  latestTag?: string | null;
  packageVersion: string;
  lockVersion: string;
};

export function validateRelease(input: ReleaseValidationInput): { version: string } {
  if (!STABLE_TAG.test(input.tag)) throw new Error("release tag must be vMAJOR.MINOR.PATCH");
  const version = input.tag.slice(1);
  const parsedVersion = semver.parse(version);
  if (!parsedVersion || parsedVersion.prerelease.length || parsedVersion.build.length) {
    throw new Error("release tag must be a stable semantic version");
  }
  if (input.packageVersion !== input.lockVersion) {
    throw new Error("package.json and package-lock.json versions differ");
  }
  if (input.tag !== `v${input.packageVersion}`) {
    throw new Error("release tag does not match the package version");
  }
  if (input.latestTag) {
    if (!STABLE_TAG.test(input.latestTag)) throw new Error("latest release tag is malformed");
    if (!semver.gt(version, input.latestTag.slice(1))) {
      throw new Error("release version must be greater than the latest stable release");
    }
  }
  return { version };
}

function parseArgs(args: string[]): { tag: string; latestTag: string | null } {
  let tag: string | null = null;
  let latestTag: string | null = null;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || value === undefined || !["--tag", "--latest-tag"].includes(key)) {
      throw new Error("usage: validate-release --tag vX.Y.Z --latest-tag vA.B.C");
    }
    if (seen.has(key)) throw new Error(`duplicate argument: ${key}`);
    seen.add(key);
    if (key === "--tag") tag = value;
    else latestTag = value || null;
  }
  if (!tag || !seen.has("--latest-tag")) {
    throw new Error("both --tag and --latest-tag are required");
  }
  return { tag, latestTag };
}

function main() {
  const { tag, latestTag } = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  const lockJson = JSON.parse(readFileSync("package-lock.json", "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || typeof lockJson.version !== "string") {
    throw new Error("package version is missing");
  }
  const result = validateRelease({
    tag,
    latestTag,
    packageVersion: packageJson.version,
    lockVersion: lockJson.version,
  });
  console.log(`stable release ${result.version} is valid`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "release validation failed");
    process.exitCode = 1;
  }
}
