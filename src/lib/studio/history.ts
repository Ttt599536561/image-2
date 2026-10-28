import { STUDIO_MODEL, type StudioJobStatus, type StudioParams } from "../../contracts/studio";

export interface StudioHistoryEntry extends StudioJobStatus {
  createdAt: number;
  params: StudioParams;
  blob?: Blob;
  conversationId?: string;
}
export const HISTORY_LIMITS = { maxEntries: 50, maxBytes: 200 * 1024 * 1024 };
export function isActive(entry: StudioHistoryEntry): boolean {
  return entry.status === "queued" || entry.status === "claimed" || entry.status === "running";
}
export function pickParams(params: StudioParams): StudioParams {
  return { prompt: params.prompt, size: params.size, model: params.model ?? STUDIO_MODEL, ...(params.quality ? { quality: params.quality } : {}), ...(params.background ? { background: params.background } : {}) };
}
/** Only an explicit allowlist ever crosses the browser persistence boundary. */
export function historySnapshot(entry: StudioHistoryEntry): StudioHistoryEntry {
  return {
    generationId: entry.generationId, createdAt: entry.createdAt, params: pickParams(entry.params),
    status: entry.status, deadlineAt: entry.deadlineAt,
    ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
    ...(entry.startedAt ? { startedAt: entry.startedAt } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.elapsedMs !== undefined ? { elapsedMs: entry.elapsedMs } : {}),
    ...(entry.image ? { image: { id: entry.image.id, url: entry.image.url, width: entry.image.width, height: entry.image.height } } : {}),
    ...(entry.error ? { error: { code: entry.error.code, message: entry.error.message } } : {}),
    ...(entry.blob ? { blob: entry.blob } : {}),
  };
}
export function pruneHistory(entries: StudioHistoryEntry[], limits = HISTORY_LIMITS): StudioHistoryEntry[] {
  const retained = [...entries];
  let bytes = retained.reduce((total, entry) => total + (entry.blob?.size ?? 0), 0);
  const removable = retained.filter((entry) => !isActive(entry)).sort((a, b) => a.createdAt - b.createdAt);
  while ((retained.length > limits.maxEntries || bytes > limits.maxBytes) && removable.length) {
    const oldest = removable.shift()!;
    retained.splice(retained.indexOf(oldest), 1);
    bytes -= oldest.blob?.size ?? 0;
  }
  return retained;
}

const DB_NAME = "image-studio-history";
const STORE = "generations";
async function openHistory(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("本浏览器不支持历史存储");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "generationId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他工作台页面后重试"));
  });
}
export async function readHistory(): Promise<StudioHistoryEntry[]> {
  const db = await openHistory();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as StudioHistoryEntry[]).map(historySnapshot).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writeHistory(entries: StudioHistoryEntry[]): Promise<void> {
  const db = await openHistory();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.clear();
      for (const entry of pruneHistory(entries)) store.put(historySnapshot(entry));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("保存中断"));
    });
  } finally { db.close(); }
}
