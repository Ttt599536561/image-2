// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getCurrentBuild } from "./version.server";

describe("getCurrentBuild", () => {
  it("uses unknown commit metadata when APP_COMMIT_SHA is absent", () => {
    expect(getCurrentBuild({ APP_VERSION: "1.2.3" })).toEqual({
      version: "1.2.3",
      commitSha: "unknown",
      shortCommitSha: "unknown",
    });
  });

  it("returns the full commit SHA and its first 12 characters", () => {
    const commitSha = "0123456789ab" + "c".repeat(28);

    expect(getCurrentBuild({ APP_VERSION: "1.2.3", APP_COMMIT_SHA: commitSha })).toEqual({
      version: "1.2.3",
      commitSha,
      shortCommitSha: "0123456789ab",
    });
  });

  it("rejects a missing APP_VERSION", () => {
    expect(() => getCurrentBuild({})).toThrow();
  });

  it.each(["1.2", "v1.2.3", "01.2.3", "1.2.3-beta.1", "1.2.3+build"]) (
    "rejects invalid APP_VERSION %s",
    (version) => expect(() => getCurrentBuild({ APP_VERSION: version })).toThrow(),
  );

  it.each([
    "A".repeat(40),
    "a".repeat(39),
    "g".repeat(40),
  ])("rejects invalid APP_COMMIT_SHA %s", (commitSha) => {
    expect(() => getCurrentBuild({ APP_VERSION: "1.2.3", APP_COMMIT_SHA: commitSha })).toThrow();
  });
});
