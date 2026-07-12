import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import {
  StartSystemUpdate,
  StartSystemUpdateResponse,
  StableRelease,
  UPDATE_PROTOCOL_VERSION,
  UpdateSnapshot,
  type BuildInfo,
  type SystemUpdateStatus,
} from "../../src/contracts/system-update";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { writeAuditHttp } from "../../src/server/admin/audit.server";
import { clientIp } from "../../src/server/rateLimit";
import { checkLatestStableRelease } from "../../src/server/system-update/github-release.server";
import { requireSystemUpdatePost } from "../../src/server/system-update/request-security.server";
import {
  createSystemUpdateReservation,
  createSystemUpdateRequest,
  readSystemUpdateStatus,
  releaseSystemUpdateReservation,
  UPDATE_INBOX_PATH,
  UPDATE_START_RESERVATION_TTL_MS,
  UpdateStartReservationConflictError,
  UpdateRequestConflictError,
  UpdateRequestPublicationUncertainError,
} from "../../src/server/system-update/state.server";
import { getCurrentBuild } from "../../src/server/system-update/version.server";
import type { Route } from "./+types/api.admin.system-update";

const MISSING_UPDATER_REASON =
  "System updater is not initialized. Run the one-time updater bootstrap.";
const INBOX_UNAVAILABLE_REASON = "System updater inbox is not writable.";
const VERSION_MISMATCH_REASON =
  "System updater status version does not match the current application version.";
const STARTABLE_PHASES = new Set<SystemUpdateStatus["phase"]>([
  "idle",
  "completed",
  "failed",
  "recovered",
]);

function unavailable(): Response {
  return httpError(503, "UPDATE_UNAVAILABLE", "System update service is unavailable.");
}

function conflict(): Response {
  return httpError(409, "UPDATE_CONFLICT", "System update state changed. Refresh and try again.");
}

function accepted(requestId: string, targetVersion: string): Response {
  return Response.json(
    StartSystemUpdateResponse.parse({ requestId, targetVersion }),
    { status: 202 },
  );
}

async function readLoaderState(build: BuildInfo): Promise<{
  status: SystemUpdateStatus | null;
  enabled: boolean;
  disabledReason: string | null;
}> {
  const status = await readSystemUpdateStatus();
  if (status === null) {
    return { status: null, enabled: false, disabledReason: MISSING_UPDATER_REASON };
  }
  if (status.currentVersion !== build.version) {
    return { status, enabled: false, disabledReason: VERSION_MISMATCH_REASON };
  }

  try {
    await access(UPDATE_INBOX_PATH, constants.W_OK);
  } catch {
    return { status, enabled: false, disabledReason: INBOX_UNAVAILABLE_REASON };
  }

  return { status, enabled: true, disabledReason: null };
}

async function readActionStatus(build: BuildInfo): Promise<SystemUpdateStatus | null> {
  const status = await readSystemUpdateStatus();
  if (status === null) return null;

  try {
    await access(UPDATE_INBOX_PATH, constants.W_OK);
  } catch {
    return null;
  }

  return status.currentVersion === build.version ? status : null;
}

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    await requireAdmin(request);
    const build = getCurrentBuild();
    const readiness = await readLoaderState(build);
    return Response.json(
      UpdateSnapshot.parse({
        enabled: readiness.enabled,
        disabledReason: readiness.disabledReason,
        build,
        status: readiness.status,
        releaseState: "unchecked",
        latestRelease: null,
      }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return unavailable();
  }
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const securityError = requireSystemUpdatePost(request);
  if (securityError !== null) return securityError;

  try {
    const admin = await requireAdmin(request);
    try {
      StartSystemUpdate.parse(await request.json());
    } catch (error) {
      if (error instanceof Response) return error;
      return httpError(400, "INVALID_PARAM", "Invalid system update request.");
    }

    const requestId = randomUUID();
    const requestedAt = new Date().toISOString();
    try {
      await createSystemUpdateReservation({
        protocolVersion: UPDATE_PROTOCOL_VERSION,
        requestId,
        requestedAt,
        expiresAt: new Date(
          Date.parse(requestedAt) + UPDATE_START_RESERVATION_TTL_MS,
        ).toISOString(),
      });
    } catch (error) {
      if (error instanceof Response) return error;
      if (error instanceof UpdateStartReservationConflictError) return conflict();
      return unavailable();
    }

    try {
      const build = getCurrentBuild();
      const status = await readActionStatus(build);
      if (status === null) return unavailable();
      if (status.maintenance || !STARTABLE_PHASES.has(status.phase)) return conflict();

      const releaseResult = await checkLatestStableRelease({
        currentVersion: build.version,
        force: true,
      });
      if (releaseResult.state !== "available" || releaseResult.release === null) {
        return conflict();
      }

      const release = StableRelease.safeParse(releaseResult.release);
      if (!release.success) return unavailable();

      const targetVersion = release.data.version;
      const updateRequest = {
        protocolVersion: UPDATE_PROTOCOL_VERSION,
        requestId,
        requestedAt,
        requestedBy: admin.userId,
      };

      try {
        await writeAuditHttp({
          adminId: admin.userId,
          action: "system_update_start",
          targetType: "system_update",
          targetId: requestId,
          after: {
            requestId,
            currentVersion: build.version,
            targetVersion,
          },
          ip: clientIp(request),
        });
      } catch (error) {
        if (error instanceof Response) return error;
        return httpError(500, "INTERNAL", "Unable to record the system update request.");
      }

      try {
        await createSystemUpdateRequest(updateRequest);
      } catch (error) {
        if (error instanceof Response) return error;
        if (error instanceof UpdateRequestConflictError) return conflict();
        if (
          error instanceof UpdateRequestPublicationUncertainError &&
          error.requestId === requestId
        ) {
          return accepted(requestId, targetVersion);
        }
        return unavailable();
      }

      return accepted(requestId, targetVersion);
    } finally {
      try {
        await releaseSystemUpdateReservation();
      } catch {
        // Cleanup must not turn a completed or uncertain publication into a retry.
      }
    }
  } catch (error) {
    if (error instanceof Response) return error;
    return unavailable();
  }
}
