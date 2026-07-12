import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink, type FileHandle } from "node:fs/promises";
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
const RESERVATION_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;

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

type ReservationFileStat = {
  dev: bigint | number;
  ino: bigint | number;
  nlink: bigint | number;
  isFile(): boolean;
};

type ReservationIdentity = {
  dev: bigint;
  ino: bigint;
};

export type SystemUpdateReservationLease = {
  requestId: string;
  markerPath: string;
  expiresAt: number;
  handle: FileHandle;
  identity: ReservationIdentity;
};

const closedReservationLeases = new WeakSet<SystemUpdateReservationLease>();

// Task 7 host contract: under the global updater lock, read this marker and
// request.json before claiming. A valid marker whose requestId matches the
// request is the only normal claim. A different valid requestId must be left or
// rejected without starting writers. If request.json exists but this marker is
// missing, leave, reject, or repair the state; never claim from status alone.
// A marker without its request may expire or be cleaned up only when stale; a
// live route keeps its marker through publication handoff for the host to claim.

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

export class UpdateStartReservationLostError extends Error {
  constructor() {
    super("The system update start reservation is no longer owned");
    this.name = "UpdateStartReservationLostError";
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

function asBigInt(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function reservationIdentity(stat: ReservationFileStat): ReservationIdentity {
  return { dev: asBigInt(stat.dev), ino: asBigInt(stat.ino) };
}

function sameReservationIdentity(
  left: ReservationIdentity,
  right: ReservationIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isLinkedRegularFile(stat: ReservationFileStat): boolean {
  return stat.isFile() && asBigInt(stat.nlink) > 0n;
}

async function reservationStat(handle: FileHandle): Promise<ReservationFileStat> {
  return (await handle.stat({ bigint: true })) as ReservationFileStat;
}

async function reservationPathStat(path: string): Promise<ReservationFileStat> {
  return (await lstat(path, { bigint: true })) as ReservationFileStat;
}

async function closeReservationHandle(handle: FileHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // A close failure cannot make cleanup unsafe or replace the primary outcome.
  }
}

async function unlinkReservationIfOwned(
  path: string,
  identity: ReservationIdentity,
): Promise<void> {
  try {
    const stat = await reservationPathStat(path);
    if (isLinkedRegularFile(stat) && sameReservationIdentity(identity, reservationIdentity(stat))) {
      await bestEffortUnlink(path);
    }
  } catch {
    // A missing or changed marker belongs to another lifecycle and is left alone.
  }
}

export async function createSystemUpdateReservation(
  reservation: SystemUpdateReservation,
  inbox = UPDATE_INBOX_PATH,
): Promise<SystemUpdateReservationLease> {
  const parsed = SystemUpdateReservation.parse(reservation);
  const bytes = Buffer.from(JSON.stringify(parsed), "utf8");
  const path = startReservationPath(inbox);

  let writeHandle: FileHandle;
  try {
    writeHandle = await open(path, REQUEST_TEMP_OPEN_FLAGS, 0o600);
  } catch (error) {
    if (hasCode(error, "EEXIST")) throw new UpdateStartReservationConflictError();
    throw error;
  }

  let writeClosed = false;
  let identity: ReservationIdentity | undefined;
  try {
    const initialStat = await reservationStat(writeHandle);
    if (!isLinkedRegularFile(initialStat)) throw new UpdateStartReservationLostError();
    identity = reservationIdentity(initialStat);

    try {
      await runAndClosePreservingPrimary(writeHandle, async () => {
        await writeComplete(writeHandle, bytes);
        await writeHandle.sync();
      });
    } finally {
      writeClosed = true;
    }

    let ownerHandle: FileHandle | undefined;
    try {
      ownerHandle = await open(path, RESERVATION_READ_FLAGS);
      const ownerStat = await reservationStat(ownerHandle);
      const pathStat = await reservationPathStat(path);
      if (
        !identity ||
        !isLinkedRegularFile(ownerStat) ||
        !isLinkedRegularFile(pathStat) ||
        !sameReservationIdentity(identity, reservationIdentity(ownerStat)) ||
        !sameReservationIdentity(identity, reservationIdentity(pathStat))
      ) {
        throw new UpdateStartReservationLostError();
      }

      return {
        requestId: parsed.requestId,
        markerPath: path,
        expiresAt: Date.parse(parsed.expiresAt),
        handle: ownerHandle,
        identity,
      };
    } catch (error) {
      await closeReservationHandle(ownerHandle);
      if (error instanceof UpdateStartReservationLostError) throw error;
      throw new UpdateStartReservationLostError();
    }
  } catch (error) {
    if (!writeClosed) await closeReservationHandle(writeHandle);
    if (identity) await unlinkReservationIfOwned(path, identity);
    throw error;
  }
}

export async function assertSystemUpdateReservationOwned(
  lease: SystemUpdateReservationLease,
): Promise<void> {
  if (closedReservationLeases.has(lease) || Date.now() >= lease.expiresAt) {
    throw new UpdateStartReservationLostError();
  }

  try {
    const ownerStat = await reservationStat(lease.handle);
    const pathStat = await reservationPathStat(lease.markerPath);
    if (
      !isLinkedRegularFile(ownerStat) ||
      !isLinkedRegularFile(pathStat) ||
      !sameReservationIdentity(lease.identity, reservationIdentity(ownerStat)) ||
      !sameReservationIdentity(lease.identity, reservationIdentity(pathStat))
    ) {
      throw new UpdateStartReservationLostError();
    }
  } catch (error) {
    if (error instanceof UpdateStartReservationLostError) throw error;
    throw new UpdateStartReservationLostError();
  }
}

export async function releaseSystemUpdateReservation(
  lease: SystemUpdateReservationLease,
): Promise<void> {
  if (closedReservationLeases.has(lease)) return;

  let mayUnlink = false;
  if (Date.now() < lease.expiresAt) {
    try {
      const ownerStat = await reservationStat(lease.handle);
      const pathStat = await reservationPathStat(lease.markerPath);
      mayUnlink =
        isLinkedRegularFile(ownerStat) &&
        isLinkedRegularFile(pathStat) &&
        sameReservationIdentity(lease.identity, reservationIdentity(ownerStat)) &&
        sameReservationIdentity(lease.identity, reservationIdentity(pathStat));
    } catch {
      mayUnlink = false;
    }
  }

  await closeReservationHandle(lease.handle);
  closedReservationLeases.add(lease);
  if (mayUnlink) await unlinkReservationIfOwned(lease.markerPath, lease.identity);
}

export async function handoffSystemUpdateReservation(
  lease: SystemUpdateReservationLease,
): Promise<void> {
  if (closedReservationLeases.has(lease)) return;
  await closeReservationHandle(lease.handle);
  closedReservationLeases.add(lease);
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
