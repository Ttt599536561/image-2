import { DEFAULT_STUDIO_BASE_URL } from "../../contracts/studio";

export const CONNECTION_STORAGE_KEY = "image-studio-connection-v1";
export type StudioConnection = { baseUrl: string; apiKey: string; rememberKey: boolean };
export const DEFAULT_CONNECTION: StudioConnection = { baseUrl: DEFAULT_STUDIO_BASE_URL, apiKey: "", rememberKey: false };

export function loadConnection(storage: Storage | null): StudioConnection {
  try {
    const value = JSON.parse(storage?.getItem(CONNECTION_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_CONNECTION };
    return {
      baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : DEFAULT_STUDIO_BASE_URL,
      apiKey: value.rememberKey === true && typeof value.apiKey === "string" ? value.apiKey : "",
      rememberKey: value.rememberKey === true,
    };
  } catch { return { ...DEFAULT_CONNECTION }; }
}

/** An unchecked remember option actively removes any previously saved key. */
export function saveConnection(connection: StudioConnection, storage: Storage | null): void {
  if (!storage) throw new Error("浏览器未开放本机存储，连接仅在当前页面可用。");
  storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
    baseUrl: connection.baseUrl,
    rememberKey: connection.rememberKey,
    ...(connection.rememberKey ? { apiKey: connection.apiKey } : {}),
  }));
}
