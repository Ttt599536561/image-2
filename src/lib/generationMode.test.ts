import { describe, expect, it } from "vitest";
import { generationSubmissionBlock } from "./generationMode";

const pendingSystem = [{ status: "running", credentialMode: "system" as const }];
const pendingCustom = [{ status: "queued", credentialMode: "custom" as const }];

describe("generationSubmissionBlock", () => {
  it("keeps the legacy single system task lock", () => {
    expect(
      generationSubmissionBlock({
        config: { mode: "system", apiKey: "" },
        ready: true,
        customEnabled: true,
        isSubmitting: false,
        isNavigating: false,
        canAfford: true,
        turns: pendingSystem,
      }),
    ).toBe("system_pending");
  });

  it("allows custom after 202 despite other pending tasks and zero site balance", () => {
    expect(
      generationSubmissionBlock({
        config: { mode: "custom", apiKey: "fictional-mode-value" },
        ready: true,
        customEnabled: true,
        isSubmitting: false,
        isNavigating: false,
        canAfford: false,
        turns: [...pendingSystem, ...pendingCustom],
      }),
    ).toBeNull();
  });

  it("fails closed for not-ready, paused, blank-key, and active enqueue or navigation states", () => {
    const base = {
      config: { mode: "custom" as const, apiKey: "fictional-mode-value" },
      ready: true,
      customEnabled: true,
      isSubmitting: false,
      isNavigating: false,
      canAfford: true,
      turns: pendingCustom,
    };
    expect(generationSubmissionBlock({ ...base, ready: false })).toBe("not_ready");
    expect(generationSubmissionBlock({ ...base, customEnabled: false })).toBe("custom_disabled");
    expect(generationSubmissionBlock({ ...base, config: { mode: "custom", apiKey: " " } })).toBe(
      "custom_key_missing",
    );
    expect(generationSubmissionBlock({ ...base, isSubmitting: true })).toBe("submitting");
    expect(generationSubmissionBlock({ ...base, isNavigating: true })).toBe("submitting");
  });
});
