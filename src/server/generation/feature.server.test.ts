// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { isCustomKeyModesEnabled } from "./feature.server";

const original = process.env.CUSTOM_KEY_MODES_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.CUSTOM_KEY_MODES_ENABLED;
  else process.env.CUSTOM_KEY_MODES_ENABLED = original;
});

describe("custom key mode feature flag", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("fails closed for %s", (value) => {
    if (value === undefined) delete process.env.CUSTOM_KEY_MODES_ENABLED;
    else process.env.CUSTOM_KEY_MODES_ENABLED = value;
    expect(isCustomKeyModesEnabled()).toBe(false);
  });

  it("enables only the exact true value", () => {
    process.env.CUSTOM_KEY_MODES_ENABLED = "true";
    expect(isCustomKeyModesEnabled()).toBe(true);
  });
});
