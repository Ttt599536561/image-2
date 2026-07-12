import { describe, expect, it } from "vitest";
import { isStableUpgrade, versionFromStableTag } from "./semver";

const oversizedVersion = "9007199254740992.0.0";

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

  it("rejects an oversized stable tag version with a controlled error", () => {
    expect(() => versionFromStableTag(`v${oversizedVersion}`)).toThrowError(
      new Error("invalid stable tag version"),
    );
  });

  it("rejects an invalid current version with the exact existing error", () => {
    expect(() => isStableUpgrade("not-a-version", "0.2.1")).toThrowError(
      new Error("invalid current version"),
    );
  });

  it("rejects non-stable target versions", () => {
    expect(() => isStableUpgrade("0.2.0", "0.2.1-alpha.1")).toThrow();
  });

  it("rejects an oversized target version with a controlled error", () => {
    expect(() => isStableUpgrade("0.2.0", oversizedVersion)).toThrowError(
      new Error("invalid target version"),
    );
  });
});
