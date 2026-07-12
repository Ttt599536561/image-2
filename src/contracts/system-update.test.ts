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

  it("defines strict build, release, snapshot, and start contracts", () => {
    const build = {
      version: "0.2.0",
      commitSha: "a".repeat(40),
      shortCommitSha: "abcdef0",
    };
    const release = {
      tag: "v0.3.0",
      version: "0.3.0",
      name: "Version 0.3.0",
      summary: "Stable release",
      htmlUrl: "https://github.com/example/project/releases/tag/v0.3.0",
      publishedAt: "2026-07-12T10:00:00.000Z",
    };
    const snapshot = {
      enabled: true,
      disabledReason: null,
      build,
      status: idle,
      releaseState: "available",
      latestRelease: release,
    };

    expect(BuildInfo.parse(build)).toEqual(build);
    expect(StableRelease.parse(release)).toEqual(release);
    expect(UpdateSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(UpdateSnapshot.safeParse({ ...snapshot, repository: "evil/repo" }).success).toBe(false);
    expect(StartSystemUpdate.parse({ action: "start" })).toEqual({ action: "start" });
    expect(StartSystemUpdate.safeParse({ action: "start", targetVersion: "0.3.0" }).success).toBe(false);
    expect(
      StartSystemUpdateResponse.parse({
        requestId: "00000000-0000-4000-8000-000000000001",
        targetVersion: "0.3.0",
      }),
    ).toEqual({
      requestId: "00000000-0000-4000-8000-000000000001",
      targetVersion: "0.3.0",
    });
  });

  it("publishes the system update API error codes", () => {
    expect(API_ERROR_CODES).toEqual(
      expect.arrayContaining(["MAINTENANCE", "UPDATE_UNAVAILABLE", "UPDATE_CONFLICT"]),
    );
  });
});
