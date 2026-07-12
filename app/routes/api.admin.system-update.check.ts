import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { UpdateSnapshot, type BuildInfo, type SystemUpdateStatus } from "../../src/contracts/system-update";
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { checkLatestStableRelease } from "../../src/server/system-update/github-release.server";
import { requireSystemUpdatePost } from "../../src/server/system-update/request-security.server";
import {
  readSystemUpdateStatus,
  UPDATE_INBOX_PATH,
} from "../../src/server/system-update/state.server";
import { getCurrentBuild } from "../../src/server/system-update/version.server";
import type { Route } from "./+types/api.admin.system-update.check";

function unavailable(): Response {
  return httpError(503, "UPDATE_UNAVAILABLE", "System update service is unavailable.");
}

async function readReadyStatus(build: BuildInfo): Promise<SystemUpdateStatus | null> {
  const status = await readSystemUpdateStatus();
  if (status === null) return null;

  try {
    await access(UPDATE_INBOX_PATH, constants.W_OK);
  } catch {
    return null;
  }

  return status.currentVersion === build.version ? status : null;
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  const securityError = requireSystemUpdatePost(request);
  if (securityError !== null) return securityError;

  try {
    await requireAdmin(request);
    const build = getCurrentBuild();
    const status = await readReadyStatus(build);
    if (status === null) return unavailable();

    const releaseResult = await checkLatestStableRelease({
      currentVersion: build.version,
      force: true,
    });
    return Response.json(
      UpdateSnapshot.parse({
        enabled: true,
        disabledReason: null,
        build,
        status,
        releaseState: releaseResult.state,
        latestRelease: releaseResult.release,
      }),
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return unavailable();
  }
}
