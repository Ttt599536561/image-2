import semver from "semver";
import { StableTag, StableVersion } from "../../contracts/system-update";

export function versionFromStableTag(tag: string): string {
  const parsedTag = StableTag.parse(tag);
  return StableVersion.parse(parsedTag.slice(1));
}

export function isStableUpgrade(current: string, target: string): boolean {
  const currentVersion = semver.valid(current);
  const targetVersion = StableVersion.parse(target);
  if (!currentVersion) throw new Error("invalid current version");
  return semver.gt(targetVersion, currentVersion);
}
