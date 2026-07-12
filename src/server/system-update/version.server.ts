import { BuildInfo } from "../../contracts/system-update";

export function getCurrentBuild(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const commitSha = env.APP_COMMIT_SHA ?? "unknown";

  return BuildInfo.parse({
    version: env.APP_VERSION,
    commitSha,
    shortCommitSha: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 12),
  });
}
