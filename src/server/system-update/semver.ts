import semver from "semver";
import { StableTag, StableVersion } from "../../contracts/system-update";

export function versionFromStableTag(tag: string): string {
  const parsedTag = StableTag.parse(tag);
  const version = StableVersion.parse(parsedTag.slice(1));
  if (semver.valid(version) !== version) throw new Error("invalid stable tag version");
  return version;
}

export function isStableUpgrade(current: string, target: string): boolean {
  const currentVersion = semver.valid(current);
  const targetVersion = StableVersion.parse(target);
  if (!currentVersion) throw new Error("invalid current version");
  if (semver.valid(targetVersion) !== targetVersion) throw new Error("invalid target version");
  return semver.gt(targetVersion, currentVersion);
}
