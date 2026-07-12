import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "./error";
import {
  BuildInfo,
  CommitSha,
  StableRelease,
  StableTag,
  StableVersion,
  StartSystemUpdate,
  StartSystemUpdateResponse,
  SYSTEM_UPDATE_PHASES,
  SystemUpdateStatus,
  UPDATE_PROTOCOL_VERSION,
  UpdateRequest,
  UpdateSnapshot,
} from "./system-update";

const idle = {
  protocolVersion: 1,
  requestId: null,
  currentVersion: "0.2.0",
  targetVersion: null,
  phase: "idle",
  maintenance: false,
  startedAt: null,
  finishedAt: null,
  updatedAt: "2026-07-12T10:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  backupId: null,
  recoveryCommand: null,
};

const fullCommitSha = `abcdef0${"1".repeat(33)}`;
const build: BuildInfo = {
  version: "0.2.0",
  commitSha: fullCommitSha,
  shortCommitSha: "abcdef0",
};
const release: StableRelease = {
  tag: "v0.3.0",
  version: "0.3.0",
  name: "Version 0.3.0",
  summary: "Stable release",
  htmlUrl: "https://github.com/Ttt599536561/image-2/releases/tag/v0.3.0",
  publishedAt: "2026-07-12T10:00:00.000Z",
};
const snapshot: UpdateSnapshot = {
  enabled: true,
  disabledReason: null,
  build,
  status: null,
  releaseState: "available",
  latestRelease: release,
};

describe("system update contracts", () => {
  it("pins the protocol version and system update phases", () => {
    expect(UPDATE_PROTOCOL_VERSION).toBe(1);
    expect(SYSTEM_UPDATE_PHASES).toEqual([
      "idle",
      "claiming",
      "validating",
      "checking_release",
      "preflight",
      "entering_maintenance",
      "draining",
      "stopping_writers",
      "backing_up",
      "fetching",
      "building",
      "migrating",
      "starting_services",
      "health_check",
      "completed",
      "failed",
      "recovery_required",
      "recovering",
      "recovered",
    ]);
  });

  it("accepts strict stable versions, tags, and commit SHAs", () => {
    expect(StableVersion.parse("0.2.0")).toBe("0.2.0");
    expect(StableTag.parse("v10.20.30")).toBe("v10.20.30");
    expect(CommitSha.parse("unknown")).toBe("unknown");
    expect(CommitSha.parse("a".repeat(40))).toBe("a".repeat(40));

    for (const version of ["01.2.3", "1.2", "1.2.3-alpha.1", "1.2.3+build"]) {
      expect(StableVersion.safeParse(version).success).toBe(false);
    }
    for (const sha of ["ABCDEF0", "a".repeat(39), "a".repeat(65)]) {
      expect(CommitSha.safeParse(sha).success).toBe(false);
    }
  });

  it("accepts the exact idle status and rejects unknown keys", () => {
    expect(SystemUpdateStatus.parse(idle)).toEqual(idle);
    expect(SystemUpdateStatus.safeParse({ ...idle, command: "sh" }).success).toBe(false);
  });

  it("requires the fixed recovery command only for recovery_required", () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const recoveryRequired = {
      ...idle,
      requestId,
      targetVersion: "0.3.0",
      phase: "recovery_required",
      maintenance: true,
      recoveryCommand: `sudo /usr/local/sbin/ai-image-workshop-update recover ${requestId}`,
    };

    expect(SystemUpdateStatus.safeParse(recoveryRequired).success).toBe(true);
    expect(
      SystemUpdateStatus.safeParse({ ...recoveryRequired, recoveryCommand: "sudo sh anything" }).success,
    ).toBe(false);
    expect(
      SystemUpdateStatus.safeParse({
        ...recoveryRequired,
        requestId: null,
        recoveryCommand: null,
      }).success,
    ).toBe(false);
    expect(
      SystemUpdateStatus.safeParse({ ...idle, recoveryCommand: recoveryRequired.recoveryCommand }).success,
    ).toBe(false);
  });

  it("accepts only the four request keys", () => {
    const request = {
      protocolVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000001",
      requestedAt: "2026-07-12T10:00:00.000Z",
      requestedBy: "00000000-0000-4000-8000-000000000002",
    };

    expect(UpdateRequest.parse(request)).toEqual(request);
    expect(UpdateRequest.safeParse({ ...request, repository: "evil/repo" }).success).toBe(false);
  });

  it("keeps unknown build SHAs paired", () => {
    expect(
      BuildInfo.safeParse({ ...build, commitSha: "unknown", shortCommitSha: "unknown" }).success,
    ).toBe(true);
    expect(
      BuildInfo.safeParse({ ...build, commitSha: "unknown", shortCommitSha: "abcdef0" }).success,
    ).toBe(false);
    expect(BuildInfo.safeParse({ ...build, shortCommitSha: "unknown" }).success).toBe(false);
  });

  it("requires a short build SHA to match the full SHA prefix", () => {
    expect(BuildInfo.safeParse({ ...build, shortCommitSha: "1234567" }).success).toBe(false);
  });

  it("requires a stable Release tag to match its version", () => {
    expect(
      StableRelease.safeParse({
        ...release,
        tag: "v0.4.0",
        htmlUrl: "https://github.com/Ttt599536561/image-2/releases/tag/v0.4.0",
      }).success,
    ).toBe(false);
  });

  it.each([
    "javascript:alert(1)",
    "http://github.com/Ttt599536561/image-2/releases/tag/v0.3.0",
    "https://github.com/other/repository/releases/tag/v0.3.0",
    "https://github.com/Ttt599536561/image-2/releases/v0.3.0",
    "https://github.com/Ttt599536561/image-2/releases/tag/v0.3.0?source=admin",
    "https://github.com/Ttt599536561/image-2/releases/tag/v0.3.0#details",
  ])("rejects a non-official release URL: %s", (htmlUrl) => {
    expect(StableRelease.safeParse({ ...release, htmlUrl }).success).toBe(false);
  });

  it("requires an available snapshot to include the latest release", () => {
    expect(UpdateSnapshot.safeParse({ ...snapshot, latestRelease: null }).success).toBe(false);
  });

  it.each(["unchecked", "none"] as const)(
    "requires a %s snapshot to omit the latest release",
    (releaseState) => {
      expect(UpdateSnapshot.safeParse({ ...snapshot, releaseState }).success).toBe(false);
    },
  );

  it("allows an up-to-date snapshot with or without the latest release", () => {
    expect(UpdateSnapshot.safeParse({ ...snapshot, releaseState: "up_to_date" }).success).toBe(true);
    expect(
      UpdateSnapshot.safeParse({
        ...snapshot,
        releaseState: "up_to_date",
        latestRelease: null,
      }).success,
    ).toBe(true);
  });

  it("defines strict build, release, snapshot, and start contracts", () => {
    const start: StartSystemUpdate = { action: "start" };
    const startResponse: StartSystemUpdateResponse = {
      requestId: "00000000-0000-4000-8000-000000000001",
      targetVersion: "0.3.0",
    };

    expect(BuildInfo.parse(build)).toEqual(build);
    expect(StableRelease.parse(release)).toEqual(release);
    expect(UpdateSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(UpdateSnapshot.safeParse({ ...snapshot, repository: "evil/repo" }).success).toBe(false);
    expect(StartSystemUpdate.parse(start)).toEqual(start);
    expect(StartSystemUpdate.safeParse({ action: "start", targetVersion: "0.3.0" }).success).toBe(false);
    expect(StartSystemUpdateResponse.parse(startResponse)).toEqual(startResponse);
  });

  it("publishes the system update API error codes", () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining(["MAINTENANCE", "UPDATE_UNAVAILABLE", "UPDATE_CONFLICT"]),
    );
  });
});
