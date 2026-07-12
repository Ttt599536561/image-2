// @vitest-environment node
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SystemUpdateStatus as SystemUpdateStatusValue,
  UpdateRequest as UpdateRequestValue,
} from "../../contracts/system-update";

type FsOverride = (...args: any[]) => Promise<any>;

const fsControl = vi.hoisted(() => ({
  open: undefined as FsOverride | undefined,
  link: undefined as FsOverride | undefined,
  lstat: undefined as FsOverride | undefined,
  mkdir: undefined as FsOverride | undefined,
  rmdir: undefined as FsOverride | undefined,
  unlink: undefined as FsOverride | undefined,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    constants: {
      ...actual.constants,
      O_NONBLOCK: actual.constants.O_NONBLOCK || 0x800,
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (...args: any[]) =>
      fsControl.open
        ? fsControl.open(...args)
        : (actual.open as (...args: any[]) => Promise<any>)(...args),
    link: (...args: any[]) =>
      fsControl.link
        ? fsControl.link(...args)
        : (actual.link as (...args: any[]) => Promise<any>)(...args),
    lstat: (...args: any[]) =>
      fsControl.lstat
        ? fsControl.lstat(...args)
        : (actual.lstat as (...args: any[]) => Promise<any>)(...args),
    mkdir: (...args: any[]) =>
      fsControl.mkdir
        ? fsControl.mkdir(...args)
        : (actual.mkdir as (...args: any[]) => Promise<any>)(...args),
    rmdir: (...args: any[]) =>
      fsControl.rmdir
        ? fsControl.rmdir(...args)
        : (actual.rmdir as (...args: any[]) => Promise<any>)(...args),
    unlink: (...args: any[]) =>
      fsControl.unlink
        ? fsControl.unlink(...args)
        : (actual.unlink as (...args: any[]) => Promise<any>)(...args),
  };
});

import {
  assertSystemUpdateReservationOwned,
  createSystemUpdateReservation,
  createSystemUpdateRequest,
  handoffSystemUpdateReservation,
  MAX_UPDATE_JSON_BYTES,
  readSystemUpdateStatus,
  releaseSystemUpdateReservation,
  UPDATE_INBOX_PATH,
  UPDATE_START_RESERVATION_PATH,
  UPDATE_START_RESERVATION_TTL_MS,
  UPDATE_STATUS_PATH,
  UpdateStartReservationConflictError,
  UpdateStartReservationLostError,
  UpdateRequestConflictError,
  UpdateRequestPublicationUncertainError,
} from "./state.server";

const status: SystemUpdateStatusValue = {
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

const request: UpdateRequestValue = {
  protocolVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  requestedAt: "2026-07-12T10:00:00.000Z",
  requestedBy: "00000000-0000-4000-8000-000000000002",
};

const reservation = {
  protocolVersion: 1 as const,
  requestId: request.requestId,
  requestedAt: "2099-07-12T10:00:00.000Z",
  expiresAt: new Date(
    Date.parse("2099-07-12T10:00:00.000Z") + UPDATE_START_RESERVATION_TTL_MS,
  ).toISOString(),
};

const tempRoots: string[] = [];
const execFileAsync = promisify(execFile);

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function fileStat(dev: bigint, ino: bigint, nlink = 1n) {
  return {
    dev,
    ino,
    nlink,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
}

function directoryStat(dev: bigint, ino: bigint, nlink = 2n) {
  return {
    dev,
    ino,
    nlink,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  };
}

function makeRequestTempHandle() {
  return {
    write: vi.fn(async (buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset) => ({
      buffer,
      bytesWritten: length,
    })),
    sync: vi.fn(async () => {}),
    stat: vi.fn(async () => fileStat(1n, 2n)),
    close: vi.fn(async () => {}),
  };
}

function makeDirectoryHandle() {
  return {
    sync: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "system-update-state-"));
  tempRoots.push(path);
  return path;
}

async function readStatusInChild(
  path: string,
): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "src/server/system-update/state.server.ts"),
  ).href;
  const source = `
    import { readSystemUpdateStatus } from ${JSON.stringify(moduleUrl)};
    try {
      await readSystemUpdateStatus(${JSON.stringify(path)});
      process.exitCode = 2;
    } catch (error) {
      process.exitCode = error instanceof Error && /regular file/i.test(error.message) ? 0 : 3;
    }
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source],
      { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    let timedOut = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 1_500);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
  });
}

beforeEach(() => {
  fsControl.open = undefined;
  fsControl.link = undefined;
  fsControl.lstat = undefined;
  fsControl.mkdir = undefined;
  fsControl.rmdir = undefined;
  fsControl.unlink = undefined;
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("system update state I/O", () => {
  it("exports the fixed updater paths and JSON limit", () => {
    expect(UPDATE_INBOX_PATH).toBe("/run/ai-image-workshop-updater/inbox");
    expect(UPDATE_START_RESERVATION_PATH).toBe(
      "/run/ai-image-workshop-updater/inbox/.start-reservation",
    );
    expect(UPDATE_START_RESERVATION_TTL_MS).toBeGreaterThanOrEqual(10 * 60 * 1_000);
    expect(UPDATE_STATUS_PATH).toBe("/run/ai-image-workshop-updater/state/status.json");
    expect(MAX_UPDATE_JSON_BYTES).toBe(64 * 1024);
  });

  it("returns null only for a missing status and parses a valid status", async () => {
    const root = await makeTempDir();
    const path = join(root, "status.json");

    await expect(readSystemUpdateStatus(path)).resolves.toBeNull();
    await writeFile(path, JSON.stringify(status));
    await expect(readSystemUpdateStatus(path)).resolves.toEqual(status);
  });

  it("rejects a final-component status symlink", async () => {
    const root = await makeTempDir();
    const target = join(root, "target.json");
    const path = join(root, "status.json");
    await writeFile(target, JSON.stringify(status));
    await symlink(target, path, "file");

    await expect(readSystemUpdateStatus(path)).rejects.toBeDefined();
  });

  it("rejects a dangling final-component status symlink", async () => {
    const root = await makeTempDir();
    const target = join(root, "missing-target.json");
    const path = join(root, "status.json");
    await symlink(target, path, "file");

    await expect(readSystemUpdateStatus(path)).rejects.toBeDefined();
  });

  it("rejects non-regular and declared-oversize status files", async () => {
    const root = await makeTempDir();
    await expect(readSystemUpdateStatus(root)).rejects.toThrow(/regular file/i);

    const oversized = join(root, "oversized.json");
    await writeFile(oversized, Buffer.alloc(MAX_UPDATE_JSON_BYTES + 1, 0x20));
    await expect(readSystemUpdateStatus(oversized)).rejects.toThrow(/64 KiB/i);
  });

  it.runIf(process.platform === "linux")(
    "rejects a FIFO without blocking the status reader",
    async () => {
      const root = await makeTempDir();
      const fifo = join(root, "status.fifo");
      await execFileAsync("mkfifo", [fifo]);

      const result = await readStatusInChild(fifo);

      expect(result.timedOut, result.stderr).toBe(false);
      expect(result.code, result.stderr).toBe(0);
    },
  );

  it.each([
    ["invalid UTF-8", Buffer.from([0xc3, 0x28])],
    ["invalid JSON", Buffer.from("{not-json", "utf8")],
    ["an unknown key", Buffer.from(JSON.stringify({ ...status, command: "sh" }))],
    ["a protocol mismatch", Buffer.from(JSON.stringify({ ...status, protocolVersion: 2 }))],
  ])("rejects %s in the status file", async (_label, bytes) => {
    const root = await makeTempDir();
    const path = join(root, "status.json");
    await writeFile(path, bytes);

    await expect(readSystemUpdateStatus(path)).rejects.toBeDefined();
  });

  it("does not turn non-ENOENT open failures into a missing status", async () => {
    const failure = errno("EACCES", "permission denied");
    fsControl.open = vi.fn(async () => {
      throw failure;
    });

    await expect(readSystemUpdateStatus("C:\\protected\\status.json")).rejects.toBe(failure);
  });

  it("fails closed without reopening when open ENOENT but the final path exists", async () => {
    const path = "C:\\updater\\status.json";
    const open = vi.fn(async () => {
      throw errno("ENOENT", "open reported missing");
    });
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    fsControl.open = open;
    fsControl.lstat = lstat;

    await expect(readSystemUpdateStatus(path)).rejects.toThrow(
      "System update status path is unavailable",
    );
    expect(open).toHaveBeenCalledOnce();
    expect(lstat).toHaveBeenCalledWith(path);
  });

  it("sanitizes lstat failures while classifying an open ENOENT", async () => {
    const path = "C:\\private\\status.json";
    const lstatFailure = errno("EACCES", `permission denied: ${path}`);
    fsControl.open = vi.fn(async () => {
      throw errno("ENOENT");
    });
    fsControl.lstat = vi.fn(async () => {
      throw lstatFailure;
    });

    const result = readSystemUpdateStatus(path);
    await expect(result).rejects.toThrow("System update status path is unavailable");
    await expect(result).rejects.not.toBe(lstatFailure);
  });

  it("adds O_NONBLOCK when opening status on POSIX", async () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    try {
      const failure = errno("EACCES");
      const open = vi.fn(async () => {
        throw failure;
      });
      fsControl.open = open;

      await expect(readSystemUpdateStatus("/run/updater/status.json")).rejects.toBe(failure);
      expect(open).toHaveBeenCalledWith(
        "/run/updater/status.json",
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } finally {
      platform.mockRestore();
    }
  });

  it("uses platform-safe flags, bounds bytes read after fstat, and always closes", async () => {
    const close = vi.fn(async () => {});
    const open = vi.fn(async () => ({
      stat: vi.fn(async () => ({ isFile: () => true, size: 1 })),
      read: vi.fn(async (buffer: Uint8Array, offset: number, length: number) => {
        buffer.fill(0x20, offset, offset + length);
        return { buffer, bytesRead: length };
      }),
      close,
    }));
    fsControl.open = open;
    fsControl.lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));

    await expect(readSystemUpdateStatus("C:\\status.json")).rejects.toThrow(/64 KiB/i);

    expect(open).toHaveBeenCalledWith(
      "C:\\status.json",
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        (process.platform === "win32" ? 0 : constants.O_NONBLOCK),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves read errors and closes the status descriptor", async () => {
    const failure = errno("EIO", "read failed");
    const close = vi.fn(async () => {});
    fsControl.open = vi.fn(async () => ({
      stat: vi.fn(async () => ({ isFile: () => true, size: 1 })),
      read: vi.fn(async () => {
        throw failure;
      }),
      close,
    }));
    fsControl.lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));

    await expect(readSystemUpdateStatus("C:\\status.json")).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("atomically creates a canonical owner token and preserves an existing reservation directory", async () => {
    const inbox = await makeTempDir();
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);

    const lease = await createSystemUpdateReservation(reservation, inbox);
    const original = await readFile(tokenPath);

    expect(original).toEqual(Buffer.from(JSON.stringify(reservation)));
    expect(lease).toMatchObject({
      requestId: reservation.requestId,
      directoryPath,
      tokenPath,
      expiresAt: Date.parse(reservation.expiresAt),
    });
    await expect(assertSystemUpdateReservationOwned(lease)).resolves.toBeUndefined();
    await expect(
      createSystemUpdateReservation(
        { ...reservation, requestId: "00000000-0000-4000-8000-000000000003" },
        inbox,
      ),
    ).rejects.toBeInstanceOf(UpdateStartReservationConflictError);
    expect(await readFile(tokenPath)).toEqual(original);
    expect(await readdir(inbox)).toEqual([".start-reservation"]);
    expect(await readdir(directoryPath)).toEqual([`${reservation.requestId}.json`]);
    await releaseSystemUpdateReservation(lease);
  });

  it("treats a partial or invalid existing owner token as a preserved conflict", async () => {
    const inbox = await makeTempDir();
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    await mkdir(directoryPath, { recursive: false, mode: 0o700 });
    await writeFile(tokenPath, "{partial");

    await expect(createSystemUpdateReservation(reservation, inbox)).rejects.toBeInstanceOf(
      UpdateStartReservationConflictError,
    );
    expect(await readFile(tokenPath, "utf8")).toBe("{partial");
  });

  it("rejects unknown reservation keys and a non-fixed expiry before filesystem I/O", async () => {
    const mkdir = vi.fn(async () => {
      throw new Error("filesystem touched");
    });
    const open = vi.fn(async () => {
      throw new Error("filesystem touched");
    });
    fsControl.mkdir = mkdir;
    fsControl.open = open;

    await expect(
      createSystemUpdateReservation(
        { ...reservation, repository: "evil/repo" } as typeof reservation,
        "C:\\updater\\inbox",
      ),
    ).rejects.toBeDefined();
    await expect(
      createSystemUpdateReservation(
        {
          ...reservation,
          expiresAt: new Date(
            Date.parse(reservation.requestedAt) + UPDATE_START_RESERVATION_TTL_MS + 1,
          ).toISOString(),
        },
        "C:\\updater\\inbox",
      ),
    ).rejects.toBeDefined();
    expect(mkdir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("fully writes, fsyncs, and closes the reservation before returning", async () => {
    const inbox = "C:\\updater\\inbox";
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    const canonical = Buffer.from(JSON.stringify(reservation));
    const chunks: Buffer[] = [];
    const events: string[] = [];
    const directoryIdentity = directoryStat(10n, 20n);
    const identity = fileStat(11n, 22n);
    const writeHandle = {
      write: vi.fn(
        async (buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset) => {
          const bytesWritten = Math.min(5, length);
          chunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
          events.push("write");
          return { buffer, bytesWritten };
        },
      ),
      sync: vi.fn(async () => {
        events.push("token-sync");
      }),
      stat: vi.fn(async () => identity),
      close: vi.fn(async () => {
        events.push("write-close");
      }),
    };
    const reservationDirectoryHandle = {
      sync: vi.fn(async () => {
        events.push("reservation-directory-sync");
      }),
      close: vi.fn(async () => {
        events.push("reservation-directory-close");
      }),
    };
    const inboxDirectoryHandle = {
      sync: vi.fn(async () => {
        events.push("inbox-sync");
      }),
      close: vi.fn(async () => {
        events.push("inbox-close");
      }),
    };
    const ownerHandle = {
      stat: vi.fn(async () => identity),
      close: vi.fn(async () => {
        events.push("owner-close");
      }),
    };

    fsControl.mkdir = vi.fn(async (path: string, options: unknown) => {
      expect(path).toBe(directoryPath);
      expect(options).toEqual({ recursive: false, mode: 0o700 });
    });
    fsControl.open = vi.fn(async (path: string, flags: number, mode?: number) => {
      if (path === directoryPath) {
        expect(flags).toBe(constants.O_RDONLY);
        return reservationDirectoryHandle;
      }
      if (path === inbox) {
        expect(flags).toBe(constants.O_RDONLY);
        return inboxDirectoryHandle;
      }
      expect(path).toBe(tokenPath);
      if (mode === 0o600) {
        expect(flags).toBe(
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
        );
        return writeHandle;
      }
      expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW);
      events.push("owner-open");
      return ownerHandle;
    });
    fsControl.lstat = vi.fn(async (path: string) =>
      path === directoryPath ? directoryIdentity : identity,
    );

    const lease = await createSystemUpdateReservation(reservation, inbox);

    expect(Buffer.concat(chunks)).toEqual(canonical);
    expect(events.indexOf("token-sync")).toBeGreaterThan(events.lastIndexOf("write"));
    expect(events.indexOf("write-close")).toBeGreaterThan(events.indexOf("token-sync"));
    expect(events.indexOf("reservation-directory-sync")).toBeGreaterThan(
      events.indexOf("write-close"),
    );
    expect(events.indexOf("inbox-sync")).toBeGreaterThan(
      events.indexOf("reservation-directory-close"),
    );
    expect(events.indexOf("owner-open")).toBeGreaterThan(events.indexOf("inbox-close"));
    expect(ownerHandle.close).not.toHaveBeenCalled();
    await handoffSystemUpdateReservation(lease);
    expect(events.at(-1)).toBe("owner-close");
  });

  it.each(["reservation-directory", "inbox"] as const)(
    "fails closed when %s durability sync fails before returning a lease",
    async (failureStage) => {
      const inbox = "C:\\updater\\inbox";
      const directoryPath = join(inbox, ".start-reservation");
      const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
      const primary = errno("EIO", `${failureStage} sync failed`);
      const directoryIdentity = directoryStat(30n, 40n);
      const tokenIdentity = fileStat(31n, 41n);
      const writeHandle = makeRequestTempHandle();
      writeHandle.stat.mockResolvedValue(tokenIdentity);
      const reservationDirectoryHandle = makeDirectoryHandle();
      const inboxDirectoryHandle = makeDirectoryHandle();
      const ownerHandle = {
        stat: vi.fn(async () => tokenIdentity),
        close: vi.fn(async () => {}),
      };
      reservationDirectoryHandle.sync.mockImplementation(async () => {
        if (failureStage === "reservation-directory") throw primary;
      });
      inboxDirectoryHandle.sync.mockImplementation(async () => {
        if (failureStage === "inbox") throw primary;
      });
      let ownerOpened = false;
      fsControl.mkdir = vi.fn(async () => {});
      fsControl.open = vi.fn(async (path: string, flags: number, mode?: number) => {
        if (path === directoryPath) return reservationDirectoryHandle;
        if (path === inbox) return inboxDirectoryHandle;
        if (mode === 0o600) return writeHandle;
        ownerOpened = true;
        expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW);
        return ownerHandle;
      });
      fsControl.lstat = vi.fn(async (path: string) =>
        path === directoryPath ? directoryIdentity : tokenIdentity,
      );
      fsControl.unlink = vi.fn(async () => {});
      fsControl.rmdir = vi.fn(async () => {});

      await expect(createSystemUpdateReservation(reservation, inbox)).rejects.toBe(primary);
      expect(ownerOpened).toBe(false);
      expect(fsControl.unlink).toHaveBeenCalledWith(tokenPath);
      expect(fsControl.rmdir).toHaveBeenCalledWith(directoryPath);
    },
  );

  it("preserves a reservation write failure when cleanup also fails", async () => {
    const inbox = "C:\\updater\\inbox";
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    const primary = new Error("reservation write failed");
    const handle = makeRequestTempHandle();
    handle.write.mockRejectedValue(primary);
    fsControl.mkdir = vi.fn(async () => {});
    fsControl.open = vi.fn(async () => handle);
    fsControl.lstat = vi.fn(async (path: string) =>
      path === directoryPath ? directoryStat(1n, 1n) : fileStat(1n, 2n),
    );
    fsControl.unlink = vi.fn(async () => {
      throw errno("EACCES", "reservation cleanup failed");
    });
    fsControl.rmdir = vi.fn(async () => {
      throw errno("EACCES", "reservation directory cleanup failed");
    });

    await expect(createSystemUpdateReservation(reservation, inbox)).rejects.toBe(primary);
    expect(fsControl.unlink).toHaveBeenCalledWith(tokenPath);
    expect(fsControl.rmdir).not.toHaveBeenCalled();
  });

  it("releases the route-owned token and tolerates a missing reservation directory", async () => {
    const inbox = await makeTempDir();
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    const lease = await createSystemUpdateReservation(reservation, inbox);

    await expect(releaseSystemUpdateReservation(lease)).resolves.toBeUndefined();
    await expect(readFile(tokenPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(directoryPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(releaseSystemUpdateReservation(lease)).resolves.toBeUndefined();
  });

  it("keeps reservation release best-effort when unlink fails", async () => {
    const inbox = await makeTempDir();
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    const lease = await createSystemUpdateReservation(reservation, inbox);
    fsControl.unlink = vi.fn(async () => {
      throw errno("EACCES", "reservation cleanup failed");
    });
    fsControl.rmdir = vi.fn(async () => {
      throw errno("ENOTEMPTY", "reservation directory still has a token");
    });

    await expect(releaseSystemUpdateReservation(lease)).resolves.toBeUndefined();
    expect(fsControl.unlink).toHaveBeenCalledWith(tokenPath);
    expect(fsControl.rmdir).not.toHaveBeenCalled();
  });

  it("does not remove a new owner directory when an expired lease releases", async () => {
    const inbox = await makeTempDir();
    const expiredRequestedAt = "2020-01-01T00:00:00.000Z";
    const reservationA = {
      ...reservation,
      requestedAt: expiredRequestedAt,
      expiresAt: new Date(
        Date.parse(expiredRequestedAt) + UPDATE_START_RESERVATION_TTL_MS,
      ).toISOString(),
    };
    const leaseA = await createSystemUpdateReservation(reservationA, inbox);
    await leaseA.handle.close();
    await rm(leaseA.tokenPath);
    await rmdir(leaseA.directoryPath);

    const reservationB = {
      ...reservation,
      requestId: "00000000-0000-4000-8000-000000000003",
    };
    const leaseB = await createSystemUpdateReservation(reservationB, inbox);
    const tokenBefore = await readFile(leaseB.tokenPath);

    await releaseSystemUpdateReservation(leaseA);

    expect(await readFile(leaseB.tokenPath)).toEqual(tokenBefore);
    expect(await readdir(leaseB.directoryPath)).toEqual([`${reservationB.requestId}.json`]);
    await releaseSystemUpdateReservation(leaseB);
  });

  it("rejects a lease whose owner token inode was removed or replaced", async () => {
    const inbox = "C:\\updater\\inbox";
    const directoryPath = join(inbox, ".start-reservation");
    const tokenPath = join(directoryPath, `${reservation.requestId}.json`);
    const oldIdentity = fileStat(51n, 61n);
    const replacementIdentity = fileStat(51n, 62n);
    const directoryIdentity = directoryStat(50n, 60n);
    const writeHandle = makeRequestTempHandle();
    writeHandle.stat.mockResolvedValue(oldIdentity);
    const ownerHandle = {
      stat: vi.fn(async () => oldIdentity),
      close: vi.fn(async () => {}),
    };
    let openCount = 0;
    fsControl.open = vi.fn(async (path: string) => {
      if (path === directoryPath || path === inbox) return makeDirectoryHandle();
      openCount += 1;
      return openCount === 1 ? writeHandle : ownerHandle;
    });
    let tokenIdentity = oldIdentity;
    fsControl.mkdir = vi.fn(async () => {});
    fsControl.lstat = vi.fn(async (path: string) =>
      path === directoryPath ? directoryIdentity : tokenIdentity,
    );
    const lease = await createSystemUpdateReservation(reservation, inbox);
    expect(lease.tokenPath).toBe(tokenPath);
    tokenIdentity = replacementIdentity;

    await expect(assertSystemUpdateReservationOwned(lease)).rejects.toBeInstanceOf(
      UpdateStartReservationLostError,
    );
    await releaseSystemUpdateReservation(lease);
  });

  it("rejects a lease whose reservation directory was replaced", async () => {
    const inbox = "C:\\updater\\inbox";
    const directoryPath = join(inbox, ".start-reservation");
    const tokenIdentity = fileStat(61n, 71n);
    const directoryIdentity = directoryStat(60n, 70n);
    const replacementDirectory = fileStat(60n, 72n);
    const writeHandle = makeRequestTempHandle();
    writeHandle.stat.mockResolvedValue(tokenIdentity);
    const ownerHandle = {
      stat: vi.fn(async () => tokenIdentity),
      close: vi.fn(async () => {}),
    };
    let openCount = 0;
    fsControl.mkdir = vi.fn(async () => {});
    fsControl.open = vi.fn(async (path: string) => {
      if (path === directoryPath || path === inbox) return makeDirectoryHandle();
      openCount += 1;
      return openCount === 1 ? writeHandle : ownerHandle;
    });
    let directoryCurrent: ReturnType<typeof directoryStat> | ReturnType<typeof fileStat> =
      directoryIdentity;
    fsControl.lstat = vi.fn(async (path: string) =>
      path === directoryPath ? directoryCurrent : tokenIdentity,
    );
    const lease = await createSystemUpdateReservation(reservation, inbox);
    directoryCurrent = replacementDirectory;

    await expect(assertSystemUpdateReservationOwned(lease)).rejects.toBeInstanceOf(
      UpdateStartReservationLostError,
    );
    await releaseSystemUpdateReservation(lease);
  });

  it("rejects an expired lease and leaves its owner token for stale-host cleanup", async () => {
    const inbox = await makeTempDir();
    const requestedAt = "2020-01-01T00:00:00.000Z";
    const expiredReservation = {
      ...reservation,
      requestedAt,
      expiresAt: new Date(
        Date.parse(requestedAt) + UPDATE_START_RESERVATION_TTL_MS,
      ).toISOString(),
    };
    const lease = await createSystemUpdateReservation(expiredReservation, inbox);
    const tokenBytes = Buffer.from(JSON.stringify(expiredReservation));

    await expect(assertSystemUpdateReservationOwned(lease)).rejects.toBeInstanceOf(
      UpdateStartReservationLostError,
    );
    await releaseSystemUpdateReservation(lease);
    expect(await readFile(lease.tokenPath)).toEqual(tokenBytes);
    expect(await readdir(lease.directoryPath)).toEqual([`${expiredReservation.requestId}.json`]);
  });

  it("hands off by closing the lease while preserving the owner token for the host", async () => {
    const inbox = await makeTempDir();
    const lease = await createSystemUpdateReservation(reservation, inbox);

    await handoffSystemUpdateReservation(lease);

    expect(await readFile(lease.tokenPath)).toEqual(Buffer.from(JSON.stringify(reservation)));
    expect(await readdir(lease.directoryPath)).toEqual([`${reservation.requestId}.json`]);
    await expect(assertSystemUpdateReservationOwned(lease)).rejects.toBeInstanceOf(
      UpdateStartReservationLostError,
    );
  });

  it("publishes canonical request bytes and preserves an existing request", async () => {
    const inbox = await makeTempDir();
    await createSystemUpdateRequest(request, inbox);
    const fixedPath = join(inbox, "request.json");
    const original = await readFile(fixedPath);

    expect(original).toEqual(Buffer.from(JSON.stringify(request)));
    await expect(createSystemUpdateRequest({ ...request, requestedBy: crypto.randomUUID() }, inbox))
      .rejects.toBeInstanceOf(UpdateRequestConflictError);
    expect(await readFile(fixedPath)).toEqual(original);
    expect(await readdir(inbox)).toEqual(["request.json"]);
  });

  it("rejects an oversized schema-valid request before filesystem I/O", async () => {
    const oversized = {
      ...request,
      requestedAt: `2026-07-12T10:00:00.${"1".repeat(MAX_UPDATE_JSON_BYTES)}Z`,
    };
    const open = vi.fn(async () => {
      throw new Error("filesystem touched");
    });
    const link = vi.fn(async () => {});
    fsControl.open = open;
    fsControl.link = link;

    await expect(createSystemUpdateRequest(oversized, "C:\\updater\\inbox")).rejects.toThrow(
      /64 KiB/i,
    );
    expect(open).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it("exposes a sanitized publication uncertainty with its request ID", () => {
    const error = new UpdateRequestPublicationUncertainError(request.requestId);

    expect(error.name).toBe("UpdateRequestPublicationUncertainError");
    expect(error.message).toBe(
      "System update request was published but durability could not be confirmed",
    );
    expect(error.requestId).toBe(request.requestId);
  });

  it("fully writes, fsyncs, and closes the temp file before linking the fixed name", async () => {
    const inbox = "C:\\updater\\inbox";
    const canonical = Buffer.from(JSON.stringify(request));
    const chunks: Buffer[] = [];
    const events: string[] = [];
    let tempPath = "";

    const tempHandle = {
      write: vi.fn(
        async (buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset) => {
          const bytesWritten = Math.min(7, length);
          chunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)));
          events.push("write");
          return { buffer, bytesWritten };
        },
      ),
      sync: vi.fn(async () => {
        events.push("file-sync");
      }),
      close: vi.fn(async () => {
        events.push("file-close");
      }),
    };
    const directoryHandle = {
      sync: vi.fn(async () => {
        events.push("directory-sync");
      }),
      close: vi.fn(async () => {
        events.push("directory-close");
      }),
    };

    fsControl.open = vi.fn(async (path: string, flags: number, mode?: number) => {
      if (path === inbox) return directoryHandle;
      tempPath = path;
      expect(flags).toBe(
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
      );
      expect(mode).toBe(0o600);
      return tempHandle;
    });
    fsControl.link = vi.fn(async (from: string, to: string) => {
      expect(events.at(-1)).toBe("file-close");
      expect(Buffer.concat(chunks)).toEqual(canonical);
      expect(from).toBe(tempPath);
      expect(to).toBe(join(inbox, "request.json"));
      events.push("link");
    });
    fsControl.unlink = vi.fn(async (path: string) => {
      expect(path).toBe(tempPath);
      events.push("unlink");
    });

    await createSystemUpdateRequest(request, inbox);

    expect(basename(tempPath)).toMatch(/^[0-9a-f-]{36}\.tmp$/);
    expect(events.indexOf("file-sync")).toBeGreaterThan(events.lastIndexOf("write"));
    expect(events.indexOf("file-close")).toBeGreaterThan(events.indexOf("file-sync"));
    expect(events.indexOf("link")).toBeGreaterThan(events.indexOf("file-close"));
    expect(events.indexOf("unlink")).toBeGreaterThan(events.indexOf("link"));
    expect(events.indexOf("directory-sync")).toBeGreaterThan(events.indexOf("unlink"));
    expect(events.indexOf("directory-close")).toBeGreaterThan(events.indexOf("directory-sync"));
    expect(events.at(-1)).toBe("directory-close");
  });

  it("retries a temp UUID collision without reporting an active-request conflict", async () => {
    const inbox = "C:\\updater\\inbox";
    const tempPaths: string[] = [];
    const tempHandle = {
      write: vi.fn(async (buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset) => ({
        buffer,
        bytesWritten: length,
      })),
      sync: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const directoryHandle = {
      sync: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };

    fsControl.open = vi.fn(async (path: string) => {
      if (path === inbox) return directoryHandle;
      tempPaths.push(path);
      if (tempPaths.length === 1) throw errno("EEXIST");
      return tempHandle;
    });
    fsControl.link = vi.fn(async () => {});
    fsControl.unlink = vi.fn(async () => {});

    await expect(createSystemUpdateRequest(request, inbox)).resolves.toBeUndefined();
    expect(tempPaths).toHaveLength(2);
    expect(new Set(tempPaths).size).toBe(2);
    expect(fsControl.unlink).toHaveBeenCalledWith(tempPaths[1]);
  });

  it.each(["open", "sync"] as const)(
    "reports sanitized publication uncertainty when directory %s fails",
    async (failureStage) => {
      const inbox = "C:\\updater\\inbox";
      const rawFailure = errno("EIO", `raw ${failureStage} failure: ${inbox}`);
      const events: string[] = [];
      let fixedVisible = false;
      const tempHandle = makeRequestTempHandle();
      const directoryHandle = makeDirectoryHandle();
      directoryHandle.sync.mockImplementation(async () => {
        events.push("directory-sync");
        expect(fixedVisible).toBe(true);
        if (failureStage === "sync") throw rawFailure;
      });
      if (failureStage === "sync") {
        directoryHandle.close.mockRejectedValue(errno("EIO", "directory close failed"));
      }

      fsControl.open = vi.fn(async (path: string) => {
        if (path !== inbox) return tempHandle;
        events.push("directory-open");
        if (failureStage === "open") throw rawFailure;
        return directoryHandle;
      });
      fsControl.link = vi.fn(async () => {
        fixedVisible = true;
        events.push("link");
      });
      fsControl.unlink = vi.fn(async () => {
        events.push("unlink");
      });

      let caught: unknown;
      try {
        await createSystemUpdateRequest(request, inbox);
      } catch (error) {
        caught = error;
      }

      expect(fixedVisible).toBe(true);
      expect(caught).toBeInstanceOf(UpdateRequestPublicationUncertainError);
      expect(caught).toMatchObject({
        name: "UpdateRequestPublicationUncertainError",
        message: "System update request was published but durability could not be confirmed",
        requestId: request.requestId,
      });
      expect(caught).not.toBe(rawFailure);
      expect(events.indexOf("unlink")).toBeGreaterThan(events.indexOf("link"));
      expect(events.indexOf("directory-open")).toBeGreaterThan(events.indexOf("unlink"));
      if (failureStage === "sync") {
        expect(events.indexOf("directory-sync")).toBeGreaterThan(events.indexOf("unlink"));
      }
    },
  );

  it("accepts a durably synced request when temp cleanup fails", async () => {
    const inbox = "C:\\updater\\inbox";
    const tempHandle = makeRequestTempHandle();
    const directoryHandle = makeDirectoryHandle();
    fsControl.open = vi.fn(async (path: string) =>
      path === inbox ? directoryHandle : tempHandle,
    );
    fsControl.link = vi.fn(async () => {});
    fsControl.unlink = vi.fn(async () => {
      throw errno("EACCES", "temp cleanup failed");
    });

    await expect(createSystemUpdateRequest(request, inbox)).resolves.toBeUndefined();
    expect(directoryHandle.sync).toHaveBeenCalledOnce();
  });

  it("accepts a durably synced request when directory close fails", async () => {
    const inbox = "C:\\updater\\inbox";
    const tempHandle = makeRequestTempHandle();
    const directoryHandle = makeDirectoryHandle();
    directoryHandle.close.mockRejectedValue(errno("EIO", "directory close failed"));
    fsControl.open = vi.fn(async (path: string) =>
      path === inbox ? directoryHandle : tempHandle,
    );
    fsControl.link = vi.fn(async () => {});
    fsControl.unlink = vi.fn(async () => {});

    await expect(createSystemUpdateRequest(request, inbox)).resolves.toBeUndefined();
    expect(directoryHandle.sync).toHaveBeenCalledOnce();
  });

  it("preserves a target conflict when temp cleanup fails", async () => {
    const inbox = "C:\\updater\\inbox";
    fsControl.open = vi.fn(async () => makeRequestTempHandle());
    fsControl.link = vi.fn(async () => {
      throw errno("EEXIST", "request exists");
    });
    fsControl.unlink = vi.fn(async () => {
      throw errno("EACCES", "temp cleanup failed");
    });

    await expect(createSystemUpdateRequest(request, inbox)).rejects.toBeInstanceOf(
      UpdateRequestConflictError,
    );
  });

  it.each(["write", "file-sync", "file-close", "link"] as const)(
    "preserves the primary %s failure when temp cleanup also fails",
    async (failureStage) => {
      const inbox = "C:\\updater\\inbox";
      const primary = new Error(`${failureStage} failed`);
      const tempHandle = makeRequestTempHandle();
      if (failureStage === "write") tempHandle.write.mockRejectedValue(primary);
      if (failureStage === "file-sync") tempHandle.sync.mockRejectedValue(primary);
      if (failureStage === "file-close") tempHandle.close.mockRejectedValue(primary);
      fsControl.open = vi.fn(async () => tempHandle);
      fsControl.link = vi.fn(async () => {
        if (failureStage === "link") throw primary;
      });
      fsControl.unlink = vi.fn(async () => {
        throw errno("EACCES", "temp cleanup failed");
      });

      await expect(createSystemUpdateRequest(request, inbox)).rejects.toBe(primary);
    },
  );

  it.each(["repository", "tag", "path", "command"])(
    "rejects caller-supplied %s before publishing",
    async (key) => {
      const inbox = await makeTempDir();
      const invalid = { ...request, [key]: "attacker-controlled" } as UpdateRequestValue;

      await expect(createSystemUpdateRequest(invalid, inbox)).rejects.toBeDefined();
      expect(await readdir(inbox)).toEqual([]);
    },
  );
});
