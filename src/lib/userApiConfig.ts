import type { CredentialMode } from "../contracts/generate";

export const CUSTOM_RELAY_BASE_URL = "https://api.tangguo.xin/v1";

export interface UserApiConfig {
  mode: CredentialMode;
  apiKey: string;
}

const DEFAULT_CONFIG: UserApiConfig = { mode: "system", apiKey: "" };
const STORAGE_PREFIX = "ai-image-workshop:user-api-config:";
const CHANGE_EVENT = "ai-image-workshop:user-api-config-changed";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function userApiStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function loadUserApiConfig(
  userId: string,
  storage: Storage | null = browserStorage(),
): UserApiConfig {
  if (!storage) return { ...DEFAULT_CONFIG };
  try {
    const raw = storage.getItem(userApiStorageKey(userId));
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as { mode?: unknown; apiKey?: unknown };
    if ((parsed.mode !== "system" && parsed.mode !== "custom") || typeof parsed.apiKey !== "string") {
      return { ...DEFAULT_CONFIG };
    }
    const apiKey = parsed.apiKey.trim();
    if (parsed.mode === "custom" && !apiKey) return { ...DEFAULT_CONFIG };
    return { mode: parsed.mode, apiKey };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function persistUserApiConfig(
  userId: string,
  config: UserApiConfig,
  storage: Storage | null = browserStorage(),
): UserApiConfig {
  const next: UserApiConfig = { mode: config.mode, apiKey: config.apiKey.trim() };
  if (storage) {
    try {
      storage.setItem(userApiStorageKey(userId), JSON.stringify(next));
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }
  notifyUserApiConfigChanged(userId);
  return next;
}

export function clearUserApiConfig(
  userId: string,
  storage: Storage | null = browserStorage(),
): UserApiConfig {
  if (storage) {
    try {
      storage.removeItem(userApiStorageKey(userId));
    } catch {
      // Clearing remains idempotent when storage is unavailable.
    }
  }
  notifyUserApiConfigChanged(userId);
  return { ...DEFAULT_CONFIG };
}

export function notifyUserApiConfigChanged(userId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId } }));
}

export function subscribeUserApiConfig(userId: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocalChange = (event: Event) => {
    if ((event as CustomEvent<{ userId?: string }>).detail?.userId === userId) listener();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === userApiStorageKey(userId)) listener();
  };
  window.addEventListener(CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
}
