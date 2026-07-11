// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildFullLocalDevArgs } from "./run-disposable-test";

describe("guarded disposable launcher", () => {
  it("starts React Router directly on the guarded Auth origin", () => {
    expect(buildFullLocalDevArgs()).toEqual(["dev", "--port", "8888", "--strictPort"]);
  });
});
