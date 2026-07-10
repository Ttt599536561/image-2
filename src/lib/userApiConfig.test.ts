import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_RELAY_BASE_URL,
  clearUserApiConfig,
  loadUserApiConfig,
  notifyUserApiConfigChanged,
  persistUserApiConfig,
  subscribeUserApiConfig,
  userApiStorageKey,
} from "./userApiConfig";

describe("userApiConfig", () => {
  beforeEach(() => localStorage.clear());

  it("defaults missing and damaged records to system mode", () => {
    expect(loadUserApiConfig("user-a", localStorage)).toEqual({ mode: "system", apiKey: "" });
    localStorage.setItem(userApiStorageKey("user-a"), "not-json");
    expect(loadUserApiConfig("user-a", localStorage)).toEqual({ mode: "system", apiKey: "" });
    localStorage.setItem(userApiStorageKey("user-a"), JSON.stringify({ mode: "other", apiKey: "x" }));
    expect(loadUserApiConfig("user-a", localStorage)).toEqual({ mode: "system", apiKey: "" });
  });

  it("isolates records by user id", () => {
    persistUserApiConfig("user-a", { mode: "custom", apiKey: "fictional-a" }, localStorage);
    persistUserApiConfig("user-b", { mode: "custom", apiKey: "fictional-b" }, localStorage);
    expect(loadUserApiConfig("user-a", localStorage).apiKey).toBe("fictional-a");
    expect(loadUserApiConfig("user-b", localStorage).apiKey).toBe("fictional-b");
  });

  it("persists only mode and a trimmed key, never the fixed URL", () => {
    persistUserApiConfig("user-a", { mode: "custom", apiKey: "  fictional-a  " }, localStorage);
    const raw = localStorage.getItem(userApiStorageKey("user-a"));
    expect(JSON.parse(raw ?? "{}")).toEqual({ mode: "custom", apiKey: "fictional-a" });
    expect(raw).not.toContain(CUSTOM_RELAY_BASE_URL);
  });

  it("keeps the saved key when switching to system", () => {
    persistUserApiConfig("user-a", { mode: "custom", apiKey: "fictional-a" }, localStorage);
    persistUserApiConfig("user-a", { mode: "system", apiKey: "fictional-a" }, localStorage);
    expect(loadUserApiConfig("user-a", localStorage)).toEqual({ mode: "system", apiKey: "fictional-a" });
  });

  it("clear removes the record and returns to system", () => {
    persistUserApiConfig("user-a", { mode: "custom", apiKey: "fictional-a" }, localStorage);
    clearUserApiConfig("user-a", localStorage);
    expect(localStorage.getItem(userApiStorageKey("user-a"))).toBeNull();
    expect(loadUserApiConfig("user-a", localStorage)).toEqual({ mode: "system", apiKey: "" });
  });

  it("is safe when browser storage is unavailable", () => {
    expect(loadUserApiConfig("user-a", null)).toEqual({ mode: "system", apiKey: "" });
    expect(() => persistUserApiConfig("user-a", { mode: "system", apiKey: "" }, null)).not.toThrow();
    expect(() => clearUserApiConfig("user-a", null)).not.toThrow();
  });

  it("notifies same-tab subscribers only for the selected user", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = subscribeUserApiConfig("user-a", listenerA);
    const unsubscribeB = subscribeUserApiConfig("user-b", listenerB);
    notifyUserApiConfigChanged("user-a");
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    unsubscribeA();
    unsubscribeB();
  });

  it("notifies cross-tab subscribers only for the selected user's storage key", () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = subscribeUserApiConfig("user-a", listenerA);
    const unsubscribeB = subscribeUserApiConfig("user-b", listenerB);

    window.dispatchEvent(new StorageEvent("storage", { key: userApiStorageKey("user-a") }));

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    unsubscribeA();
    unsubscribeB();
  });
});
