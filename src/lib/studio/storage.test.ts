import { beforeEach, describe, expect, it } from "vitest";
import { loadConnection, saveConnection, CONNECTION_STORAGE_KEY } from "./connection";
import { historySnapshot, pruneHistory, type StudioHistoryEntry } from "./history";

describe("studio connection privacy", () => {
  beforeEach(() => localStorage.clear());
  it("keeps the URL but only persists a key after an explicit remember choice", () => {
    const connection = { baseUrl: "https://example.com/v1", apiKey: "secret-fixture", rememberKey: false };
    saveConnection(connection, localStorage);
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).not.toContain("secret-fixture");
    expect(loadConnection(localStorage)).toEqual({ ...connection, apiKey: "" });
    saveConnection({ ...connection, rememberKey: true }, localStorage);
    expect(loadConnection(localStorage).apiKey).toBe("secret-fixture");
    saveConnection(connection, localStorage);
    expect(loadConnection(localStorage).apiKey).toBe("");
  });
  it("returns defaults for unavailable or damaged storage", () => {
    localStorage.setItem(CONNECTION_STORAGE_KEY, "bad-json");
    expect(loadConnection(localStorage).baseUrl).toBe("https://api.tangguo.xin/v1");
    expect(loadConnection(null).rememberKey).toBe(false);
  });
});

function record(id: string, createdAt: number, status: StudioHistoryEntry["status"] = "succeeded"): StudioHistoryEntry {
  return { generationId: id, createdAt, status, params: { prompt: id, size: "auto", quality: "auto" }, deadlineAt: new Date(createdAt + 600000).toISOString() };
}
describe("device history", () => {
  it("whitelists generation parameters and strips credentials from nested and root fields", () => {
    const saved = historySnapshot({ ...record("one", 1), apiKey: "root-secret", baseUrl: "private-url", params: { prompt: "a cat", size: "auto", apiKey: "nested-secret", baseUrl: "private-url" } } as unknown as StudioHistoryEntry);
    expect(JSON.stringify(saved)).not.toMatch(/secret|baseUrl|apiKey/);
    expect(saved.params).toEqual({ prompt: "a cat", size: "auto" });
  });
  it("evicts oldest completed records while preserving active work", () => {
    const active = record("active", 0, "running");
    expect(pruneHistory([active, record("old", 1), record("new", 2)], { maxEntries: 2, maxBytes: 100 }).map((x) => x.generationId)).toEqual(["active", "new"]);
  });
  it("enforces the blob byte limit independently of the entry limit", () => {
    const entries = [record("old", 1), record("new", 2)].map((entry) => ({ ...entry, blob: new Blob(["123456"]) }));
    expect(pruneHistory(entries, { maxEntries: 50, maxBytes: 8 }).map((x) => x.generationId)).toEqual(["new"]);
  });
});
