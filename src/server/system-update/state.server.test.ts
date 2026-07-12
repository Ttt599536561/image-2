// @vitest-environment node
import { constants } from "node:fs";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  unlink: undefined as FsOverride | undefined,
}));

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
    unlink: (...args: any[]) =>
      fsControl.unlink
        ? fsControl.unlink(...args)
        : (actual.unlink as (...args: any[]) => Promise<any>)(...args),
  };
});

import {
  createSystemUpdateRequest,
  MAX_UPDATE_JSON_BYTES,
  readSystemUpdateStatus,
  UPDATE_INBOX_PATH,
  UPDATE_STATUS_PATH,
  UpdateRequestConflictError,
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

const tempRoots: string[] = [];

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

async function makeTempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "system-update-state-"));
  tempRoots.push(path);
  return path;
}

beforeEach(() => {
  fsControl.open = undefined;
  fsControl.link = undefined;
  fsControl.lstat = undefined;
  fsControl.unlink = undefined;
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("system update state I/O", () => {
  it("exports the fixed updater paths and JSON limit", () => {
    expect(UPDATE_INBOX_PATH).toBe("/run/ai-image-workshop-updater/inbox");
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

  it("rejects non-regular and declared-oversize status files", async () => {
    const root = await makeTempDir();
    await expect(readSystemUpdateStatus(root)).rejects.toThrow(/regular file/i);

    const oversized = join(root, "oversized.json");
    await writeFile(oversized, Buffer.alloc(MAX_UPDATE_JSON_BYTES + 1, 0x20));
    await expect(readSystemUpdateStatus(oversized)).rejects.toThrow(/64 KiB/i);
  });

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

  it("uses O_NOFOLLOW, bounds bytes read after fstat, and always closes", async () => {
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
      constants.O_RDONLY | constants.O_NOFOLLOW,
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
    expect(events.indexOf("directory-sync")).toBeGreaterThan(events.indexOf("link"));
    expect(events.indexOf("directory-close")).toBeGreaterThan(events.indexOf("directory-sync"));
    expect(events.at(-1)).toBe("unlink");
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

  it("unlinks the temp file and preserves non-link filesystem failures", async () => {
    const inbox = "C:\\updater\\inbox";
    const failure = errno("EIO", "directory fsync failed");
    const tempHandle = {
      write: vi.fn(async (buffer: Uint8Array, offset = 0, length = buffer.byteLength - offset) => ({
        buffer,
        bytesWritten: length,
      })),
      sync: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const directoryHandle = {
      sync: vi.fn(async () => {
        throw failure;
      }),
      close: vi.fn(async () => {}),
    };

    fsControl.open = vi.fn(async (path: string) =>
      path === inbox ? directoryHandle : tempHandle,
    );
    fsControl.link = vi.fn(async () => {});
    fsControl.unlink = vi.fn(async () => {});

    await expect(createSystemUpdateRequest(request, inbox)).rejects.toBe(failure);
    expect(fsControl.unlink).toHaveBeenCalledOnce();
    expect(directoryHandle.close).toHaveBeenCalledOnce();
  });

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
