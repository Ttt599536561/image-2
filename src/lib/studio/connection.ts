import { DEFAULT_STUDIO_BASE_URL } from "../../contracts/studio";

export const CONNECTION_STORAGE_KEY = "image-studio-connection-v1";
export type StudioConnection = { baseUrl: string; apiKey: string; rememberKey: boolean };
export const DEFAULT_CONNECTION: StudioConnection = { baseUrl: DEFAULT_STUDIO_BASE_URL, apiKey: "", rememberKey: false };

function isSameService(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string") return false;
  try { return new URL(baseUrl).href.replace(/\/+$/, "") === DEFAULT_STUDIO_BASE_URL; }
  catch { return false; }
}

export function loadConnection(storage: Storage | null): StudioConnection {
  try {
    const value = JSON.parse(storage?.getItem(CONNECTION_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_CONNECTION };
    // A key belongs to the service it was saved for. Never repoint legacy credentials.
    if (!isSameService(value.baseUrl)) return { ...DEFAULT_CONNECTION };
    return {
      baseUrl: DEFAULT_STUDIO_BASE_URL,
      apiKey: value.rememberKey === true && typeof value.apiKey === "string" ? value.apiKey : "",
      rememberKey: value.rememberKey === true,
    };
  } catch { return { ...DEFAULT_CONNECTION }; }
}

/** An unchecked remember option actively removes any previously saved key. */
export function saveConnection(connection: StudioConnection, storage: Storage | null): void {
  if (!storage) throw new Error("浏览器未开放本机存储，连接仅在当前页面可用。");
  storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
    baseUrl: DEFAULT_STUDIO_BASE_URL,
    rememberKey: connection.rememberKey,
    ...(connection.rememberKey ? { apiKey: connection.apiKey } : {}),
  }));
}
