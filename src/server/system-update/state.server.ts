import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  SystemUpdateStatus,
  type SystemUpdateStatus as SystemUpdateStatusValue,
  UPDATE_PROTOCOL_VERSION,
  UpdateRequest,
  type UpdateRequest as UpdateRequestValue,
} from "../../contracts/system-update";

export const UPDATE_INBOX_PATH = "/run/ai-image-workshop-updater/inbox";
export const UPDATE_START_RESERVATION_PATH =
  "/run/ai-image-workshop-updater/inbox/.start-reservation.json";
export const UPDATE_START_RESERVATION_TTL_MS = 15 * 60 * 1_000;
export const UPDATE_STATUS_PATH = "/run/ai-image-workshop-updater/state/status.json";
export const MAX_UPDATE_JSON_BYTES = 64 * 1024;

const TEMP_FILE_ATTEMPTS = 10;
const START_RESERVATION_FILENAME = ".start-reservation.json";
const REQUEST_TEMP_OPEN_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

const SystemUpdateReservation = z
  .object({
    protocolVersion: z.literal(UPDATE_PROTOCOL_VERSION),
    requestId: z.uuid(),
    requestedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((reservation, ctx) => {
    if (
      Date.parse(reservation.expiresAt) - Date.parse(reservation.requestedAt) !==
      UPDATE_START_RESERVATION_TTL_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "invalid reservation expiry",
      });
    }
  });
export type SystemUpdateReservation = z.infer<typeof SystemUpdateReservation>;

// Task 7 host contract: before claiming request.json, read this marker. A valid
// matching requestId may proceed. A different valid requestId must leave/reject
// the request without starting writers; stale or invalid markers remain busy
// until expiry handling or operator repair.

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function sizeError(): Error {
  return new Error("System update JSON exceeds the 64 KiB limit");
}

function statusPathUnavailableError(): Error {
  return new Error("System update status path is unavailable");
}

function statusOpenFlags(): number {
  return (
    constants.O_RDONLY |
    constants.O_NOFOLLOW |
    (process.platform === "win32" ? 0 : constants.O_NONBLOCK)
  );
}

async function confirmStatusPathMissing(path: string): Promise<null> {
  try {
    await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw statusPathUnavailableError();
  }
  throw statusPathUnavailableError();
}

export async function readSystemUpdateStatus(
  path = UPDATE_STATUS_PATH,
): Promise<SystemUpdateStatusValue | null> {
  let handle;
  try {
    handle = await open(path, statusOpenFlags());
  } catch (error) {
    if (hasCode(error, "ENOENT")) return confirmStatusPathMissing(path);
    throw error;
  }

  try {
    // Windows accepts O_NOFOLLOW but still follows final-component symlinks.
    if (process.platform === "win32" && (await lstat(path)).isSymbolicLink()) {
      throw Object.assign(new Error("System update status must not be a symbolic link"), {
        code: "ELOOP",
      });
    }

    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("System update status must be a regular file");
    }
    if (stat.size > MAX_UPDATE_JSON_BYTES) throw sizeError();

    const buffer = Buffer.allocUnsafe(MAX_UPDATE_JSON_BYTES + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.byteLength - total,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_UPDATE_JSON_BYTES) throw sizeError();

    const json = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
    return SystemUpdateStatus.parse(JSON.parse(json));
  } finally {
    await handle.close();
  }
}

export class UpdateRequestConflictError extends Error {
  constructor() {
    super("A system update request is already active");
    this.name = "UpdateRequestConflictError";
  }
}

export class UpdateStartReservationConflictError extends Error {
  constructor() {
    super("A system update start is already reserved");
    this.name = "UpdateStartReservationConflictError";
  }
}

export class UpdateRequestPublicationUncertainError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super("System update request was published but durability could not be confirmed");
    this.name = "UpdateRequestPublicationUncertainError";
    this.requestId = requestId;
  }
}

async function openRequestTemp(inbox: string) {
  for (let attempt = 0; attempt < TEMP_FILE_ATTEMPTS; attempt += 1) {
    const path = join(inbox, `${randomUUID()}.tmp`);
    try {
      return {
        path,
        handle: await open(path, REQUEST_TEMP_OPEN_FLAGS, 0o600),
      };
    } catch (error) {
      if (hasCode(error, "EEXIST")) continue;
      throw error;
    }
  }
  throw new Error("Unable to create a unique system update request temp file");
}

async function writeComplete(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (bytesWritten <= 0) {
      throw new Error("Unable to complete the system update request write");
    }
    offset += bytesWritten;
  }
}

async function runAndClosePreservingPrimary(
  handle: { close(): Promise<void> },
  operation: () => Promise<void>,
): Promise<void> {
  let failed = false;
  let primaryError: unknown;
  try {
    await operation();
  } catch (error) {
    failed = true;
    primaryError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (!failed) {
      failed = true;
      primaryError = error;
    }
  }
  if (failed) throw primaryError;
}

async function bestEffortUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Cleanup cannot replace publication or pre-publication outcomes.
  }
}

function startReservationPath(inbox: string): string {
  return inbox === UPDATE_INBOX_PATH
    ? UPDATE_START_RESERVATION_PATH
    : join(inbox, START_RESERVATION_FILENAME);
}

export async function createSystemUpdateReservation(
  reservation: SystemUpdateReservation,
  inbox = UPDATE_INBOX_PATH,
): Promise<void> {
  const parsed = SystemUpdateReservation.parse(reservation);
  const bytes = Buffer.from(JSON.stringify(parsed), "utf8");
  const path = startReservationPath(inbox);

  let handle;
  try {
    handle = await open(path, REQUEST_TEMP_OPEN_FLAGS, 0o600);
  } catch (error) {
    if (hasCode(error, "EEXIST")) throw new UpdateStartReservationConflictError();
    throw error;
  }

  try {
    await runAndClosePreservingPrimary(handle, async () => {
      await writeComplete(handle, bytes);
      await handle.sync();
    });
  } catch (error) {
    await bestEffortUnlink(path);
    throw error;
  }
}

export async function releaseSystemUpdateReservation(
  inbox = UPDATE_INBOX_PATH,
): Promise<void> {
  // Only the route that successfully created the marker releases it. The host
  // never replaces it; failed cleanup leaves a conservative busy marker.
  await bestEffortUnlink(startReservationPath(inbox));
}

async function syncInbox(inbox: string): Promise<boolean> {
  let directory;
  try {
    directory = await open(inbox, constants.O_RDONLY);
  } catch {
    return false;
  }

  let synced = false;
  try {
    await directory.sync();
    synced = true;
  } catch (error) {
    synced = process.platform === "win32" && hasCode(error, "EPERM");
  }
  try {
    await directory.close();
  } catch {
    // A close failure cannot downgrade an already durable publication.
  }
  return synced;
}

export async function createSystemUpdateRequest(
  request: UpdateRequestValue,
  inbox = UPDATE_INBOX_PATH,
): Promise<void> {
  const parsed = UpdateRequest.parse(request);
  const bytes = Buffer.from(JSON.stringify(parsed), "utf8");
  if (bytes.byteLength > MAX_UPDATE_JSON_BYTES) throw sizeError();
  const { path: tempPath, handle } = await openRequestTemp(inbox);
  let published = false;

  try {
    await runAndClosePreservingPrimary(handle, async () => {
      await writeComplete(handle, bytes);
      await handle.sync();
    });

    const fixedPath = join(inbox, "request.json");
    try {
      await link(tempPath, fixedPath);
    } catch (error) {
      if (hasCode(error, "EEXIST")) throw new UpdateRequestConflictError();
      throw error;
    }
    published = true;

    await bestEffortUnlink(tempPath);
    if (!(await syncInbox(inbox))) {
      throw new UpdateRequestPublicationUncertainError(parsed.requestId);
    }
  } catch (error) {
    if (!published) await bestEffortUnlink(tempPath);
    throw error;
  }
}
