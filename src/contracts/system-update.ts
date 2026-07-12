import { z } from "zod";

export const UPDATE_PROTOCOL_VERSION = 1 as const;

export const SYSTEM_UPDATE_PHASES = [
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
] as const;

export const SystemUpdatePhase = z.enum(SYSTEM_UPDATE_PHASES);
export type SystemUpdatePhase = z.infer<typeof SystemUpdatePhase>;

export const StableVersion = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const StableTag = z
  .string()
  .regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const CommitSha = z.string().regex(/^(unknown|[0-9a-f]{40,64})$/);

export const UpdateRequest = z
  .object({
    protocolVersion: z.literal(UPDATE_PROTOCOL_VERSION),
    requestId: z.uuid(),
    requestedAt: z.iso.datetime(),
    requestedBy: z.uuid(),
  })
  .strict();
export type UpdateRequest = z.infer<typeof UpdateRequest>;

const nullableVersion = StableVersion.nullable();
const nullableTime = z.iso.datetime().nullable();

export const SystemUpdateStatus = z
  .object({
    protocolVersion: z.literal(UPDATE_PROTOCOL_VERSION),
    requestId: z.uuid().nullable(),
    currentVersion: StableVersion,
    targetVersion: nullableVersion,
    phase: SystemUpdatePhase,
    maintenance: z.boolean(),
    startedAt: nullableTime,
    finishedAt: nullableTime,
    updatedAt: z.iso.datetime(),
    errorCode: z.string().max(80).nullable(),
    errorMessage: z.string().max(500).nullable(),
    backupId: z.string().regex(/^\d{8}T\d{6}Z$/).nullable(),
    recoveryCommand: z.string().max(200).nullable(),
  })
  .strict()
  .superRefine((status, ctx) => {
    const expected =
      status.requestId == null
        ? null
        : `sudo /usr/local/sbin/ai-image-workshop-update recover ${status.requestId}`;

    if (
      status.phase === "recovery_required" &&
      (expected === null || status.recoveryCommand !== expected)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recoveryCommand"],
        message: "invalid recovery command",
      });
    }
    if (status.phase !== "recovery_required" && status.recoveryCommand !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["recoveryCommand"],
        message: "unexpected recovery command",
      });
    }
  });
export type SystemUpdateStatus = z.infer<typeof SystemUpdateStatus>;

export const BuildInfo = z
  .object({
    version: StableVersion,
    commitSha: CommitSha,
    shortCommitSha: z.string().regex(/^(unknown|[0-9a-f]{7,12})$/),
  })
  .strict()
  .superRefine((build, ctx) => {
    const matchesCommit =
      build.commitSha === "unknown"
        ? build.shortCommitSha === "unknown"
        : build.shortCommitSha !== "unknown" && build.commitSha.startsWith(build.shortCommitSha);

    if (!matchesCommit) {
      ctx.addIssue({
        code: "custom",
        path: ["shortCommitSha"],
        message: "short commit SHA does not match commit SHA",
      });
    }
  });
export type BuildInfo = z.infer<typeof BuildInfo>;

export const StableRelease = z
  .object({
    tag: StableTag,
    version: StableVersion,
    name: z.string().max(200),
    summary: z.string().max(1000),
    htmlUrl: z.url(),
    publishedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((release, ctx) => {
    if (release.tag !== `v${release.version}`) {
      ctx.addIssue({
        code: "custom",
        path: ["tag"],
        message: "release tag does not match version",
      });
    }

    const expectedUrl = `https://github.com/Ttt599536561/image-2/releases/tag/${release.tag}`;
    if (release.htmlUrl !== expectedUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["htmlUrl"],
        message: "invalid release URL",
      });
    }
  });
export type StableRelease = z.infer<typeof StableRelease>;

export const UpdateSnapshot = z
  .object({
    enabled: z.boolean(),
    disabledReason: z.string().max(300).nullable(),
    build: BuildInfo,
    status: SystemUpdateStatus.nullable(),
    releaseState: z.enum(["unchecked", "none", "up_to_date", "available"]),
    latestRelease: StableRelease.nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (snapshot.releaseState === "available" && snapshot.latestRelease === null) {
      ctx.addIssue({
        code: "custom",
        path: ["latestRelease"],
        message: "available release is missing",
      });
    }
    if (
      (snapshot.releaseState === "unchecked" || snapshot.releaseState === "none") &&
      snapshot.latestRelease !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["latestRelease"],
        message: "unexpected latest release",
      });
    }
  });
export type UpdateSnapshot = z.infer<typeof UpdateSnapshot>;

export const StartSystemUpdate = z.object({ action: z.literal("start") }).strict();
export type StartSystemUpdate = z.infer<typeof StartSystemUpdate>;

export const StartSystemUpdateResponse = z
  .object({
    requestId: z.uuid(),
    targetVersion: StableVersion,
  })
  .strict();
export type StartSystemUpdateResponse = z.infer<typeof StartSystemUpdateResponse>;
