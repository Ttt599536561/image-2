import { describe, expect, it } from "vitest";
import { isStableUpgrade, versionFromStableTag } from "./semver";

describe("stable system update versions", () => {
  it("extracts a stable version from a stable Release tag", () => {
    expect(versionFromStableTag("v1.2.3")).toBe("1.2.3");
  });

  it.each(["v1.0.0-alpha.1", "v01.0.0", "1.0.0", "v1.0", "v1.0.0+build"])(
    "rejects %s as a stable Release tag",
    (tag) => expect(() => versionFromStableTag(tag)).toThrow(),
  );

  it("allows only a strictly higher stable version and ignores current build metadata", () => {
    expect(isStableUpgrade("0.2.0+abc123", "0.2.1")).toBe(true);
    expect(isStableUpgrade("0.2.0+abc123", "0.2.0")).toBe(false);
    expect(isStableUpgrade("1.0.0", "0.9.9")).toBe(false);
  });

  it("rejects invalid current and non-stable target versions", () => {
    expect(() => isStableUpgrade("not-a-version", "0.2.1")).toThrow("invalid current version");
    expect(() => isStableUpgrade("0.2.0", "0.2.1-alpha.1")).toThrow();
  });
});
