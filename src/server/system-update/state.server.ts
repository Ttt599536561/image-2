import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  SystemUpdateStatus,
  type SystemUpdateStatus as SystemUpdateStatusValue,
  UpdateRequest,
  type UpdateRequest as UpdateRequestValue,
} from "../../contracts/system-update";

export const UPDATE_INBOX_PATH = "/run/ai-image-workshop-updater/inbox";
export const UPDATE_STATUS_PATH = "/run/ai-image-workshop-updater/state/status.json";
export const MAX_UPDATE_JSON_BYTES = 64 * 1024;

const TEMP_FILE_ATTEMPTS = 10;
const STATUS_OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const REQUEST_TEMP_OPEN_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function sizeError(): Error {
  return new Error("System update JSON exceeds the 64 KiB limit");
}

export async function readSystemUpdateStatus(
  path = UPDATE_STATUS_PATH,
): Promise<SystemUpdateStatusValue | null> {
  let handle;
  try {
    handle = await open(path, STATUS_OPEN_FLAGS);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
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

async function syncInbox(inbox: string): Promise<void> {
  const directory = await open(inbox, constants.O_RDONLY);
  try {
    try {
      await directory.sync();
    } catch (error) {
      if (!(process.platform === "win32" && hasCode(error, "EPERM"))) throw error;
    }
  } finally {
    await directory.close();
  }
}

export async function createSystemUpdateRequest(
  request: UpdateRequestValue,
  inbox = UPDATE_INBOX_PATH,
): Promise<void> {
  const parsed = UpdateRequest.parse(request);
  const bytes = Buffer.from(JSON.stringify(parsed), "utf8");
  const { path: tempPath, handle } = await openRequestTemp(inbox);

  try {
    try {
      await writeComplete(handle, bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    const fixedPath = join(inbox, "request.json");
    try {
      await link(tempPath, fixedPath);
    } catch (error) {
      if (hasCode(error, "EEXIST")) throw new UpdateRequestConflictError();
      throw error;
    }

    await syncInbox(inbox);
  } finally {
    await unlink(tempPath);
  }
}
