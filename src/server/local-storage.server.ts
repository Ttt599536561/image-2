import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export function isLocalStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STORAGE_DRIVER === "local" || env.DISPOSABLE_TEST_DB_DRIVER === "pg";
}

function storageRoot(): string {
  return resolve(
    process.env.LOCAL_STORAGE_ROOT ||
      process.env.LOCAL_TEST_STORAGE_ROOT ||
      resolve(process.cwd(), ".local-test-storage"),
  );
}

function storageSegments(storageKey: string): string[] {
  const segments = storageKey.replace(/\\/g, "/").split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("[local-storage] invalid storage key");
  }
  return segments;
}

function storagePath(storageKey: string): string {
  const segments = storageSegments(storageKey);
  const root = storageRoot();
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("[local-storage] invalid storage key");
  }
  return target;
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function assertCanonicalPath(root: string, target: string): void {
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("[local-storage] invalid storage key");
  }
}

async function canonicalStorageRoot(): Promise<string> {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  return realpath(root);
}

async function resolveExistingStoragePath(
  storageKey: string,
  allowMissing = false,
): Promise<string | null> {
  const segments = storageSegments(storageKey);
  const root = await canonicalStorageRoot();
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (allowMissing && isFileSystemError(error, "ENOENT")) return null;
      throw error;
    }
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) {
      throw new Error("[local-storage] invalid storage key");
    }
    assertCanonicalPath(root, await realpath(current));
  }

  return current;
}

async function resolveWritableStoragePath(storageKey: string): Promise<string> {
  const segments = storageSegments(storageKey);
  const root = await canonicalStorageRoot();
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("[local-storage] invalid storage key");
    }
    assertCanonicalPath(root, await realpath(current));
  }

  const target = resolve(current, segments.at(-1) as string);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("[local-storage] invalid storage key");
    }
    assertCanonicalPath(root, await realpath(target));
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) throw error;
  }
  return target;
}

export function localStoragePublicUrl(storageKey: string): string {
  return `/media/${storageSegments(storageKey).map(encodeURIComponent).join("/")}`;
}

export function storageKeyFromLocalPublicUrl(value: string): string | null {
  try {
    const url = new URL(value, "http://local-storage.invalid");
    const prefix = "/media/";
    if (!url.pathname.startsWith(prefix)) return null;
    const encodedSegments = url.pathname.slice(prefix.length).split("/");
    if (encodedSegments.some((segment) => !segment)) return null;
    const segments = encodedSegments.map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => segment.includes("/") || segment.includes("\\"))) return null;
    const key = segments.join("/");
    storagePath(key);
    return key;
  } catch {
    return null;
  }
}

export function contentTypeForStorageKey(storageKey: string): string {
  const extension = storageKey.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

export async function writeLocalStorageObject(
  storageKey: string,
  bytes: Uint8Array,
): Promise<void> {
  const path = await resolveWritableStoragePath(storageKey);
  await writeFile(path, bytes);
}

export async function readLocalStorageObject(storageKey: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}> {
  const path = await resolveExistingStoragePath(storageKey);
  if (!path) throw new Error("[local-storage] object not found");
  const bytes = new Uint8Array(await readFile(path));
  return {
    bytes,
    contentType: contentTypeForStorageKey(storageKey),
    filename: storageKey.split("/").pop() || "image.png",
  };
}

export async function deleteLocalStorageObject(storageKey: string): Promise<void> {
  const path = await resolveExistingStoragePath(storageKey, true);
  if (path) await rm(path, { force: true });
}

export async function deleteLocalStorageObjects(storageKeys: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const storageKey of storageKeys) {
    try {
      await deleteLocalStorageObject(storageKey);
    } catch {
      failed.push(storageKey);
    }
  }
  return failed;
}

export async function listLocalStorageObjects(): Promise<Array<{
  key: string;
  lastModified: number;
}>> {
  const root = await canonicalStorageRoot();
  const objects: Array<{ key: string; lastModified: number }> = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const info = await stat(path);
        objects.push({
          key: relative(root, path).replace(/\\/g, "/"),
          lastModified: info.mtimeMs,
        });
      }
    }
  }

  await visit(root);
  return objects;
}
