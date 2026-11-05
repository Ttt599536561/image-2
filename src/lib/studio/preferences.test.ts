import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_PREFERENCES, loadPreferences, PREFERENCES_STORAGE_KEY, savePreferences } from "./preferences";

describe("studio generation preferences", () => {
  beforeEach(() => localStorage.clear());
  const preferences = { model: "gpt-image-2.6-flare", size: "1920x1088", quality: "high", background: "auto", outputFormat: "gif" } as const;

  it("stores only generation settings and restores all choices including GIF", () => {
    savePreferences({ ...preferences, prompt: "private prompt", apiKey: "private key", inputImageKeys: ["private/reference"] }, localStorage);
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!)).toEqual(preferences);
    expect(loadPreferences(localStorage)).toEqual(preferences);
  });

  it("uses defaults when no preferences have been saved", () => {
    expect(loadPreferences(localStorage)).toEqual(DEFAULT_STUDIO_PREFERENCES);
    expect(loadPreferences(localStorage).outputFormat).toBe("png");
  });

  it.each(["not-json", "null", "[]", "42"])("ignores unusable saved values: %s", (saved) => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, saved);
    expect(loadPreferences(localStorage)).toEqual(DEFAULT_STUDIO_PREFERENCES);
  });

  it("falls back only for invalid settings without discarding valid choices", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ model: "unknown-model", size: "1920x1088", quality: "invalid-quality", background: "transparent", outputFormat: "unknown-format", prompt: "not a preference" }));
    expect(loadPreferences(localStorage)).toEqual({ ...DEFAULT_STUDIO_PREFERENCES, size: "1920x1088", background: "transparent" });
  });

  it("leaves unavailable storage handling to the caller", () => {
    expect(() => loadPreferences({ getItem() { throw new Error("storage blocked"); } })).toThrow("storage blocked");
    expect(() => savePreferences(preferences, { setItem() { throw new Error("storage blocked"); } })).toThrow("storage blocked");
  });
});
