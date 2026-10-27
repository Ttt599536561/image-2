// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildFullLocalDevArgs } from "./run-disposable-test";

describe("guarded disposable launcher", () => {
  it("starts React Router directly on the guarded Auth origin", () => {
    expect(buildFullLocalDevArgs()).toEqual(["dev", "--port", "8888", "--strictPort"]);
  });

  it("supports an isolated loopback test port without reusing the development server", () => {
    expect(buildFullLocalDevArgs("http://localhost:18900")).toEqual(["dev", "--port", "18900", "--strictPort"]);
  });

  it("rejects a non-loopback test origin", () => {
    expect(() => buildFullLocalDevArgs("https://example.com")).toThrow("loopback");
  });
});
