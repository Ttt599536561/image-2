import { describe, expect, it } from "vitest";
import { appendReferences } from "./references";
const file = (name: string, type = "image/png") => new File(["image"], name, { type });
describe("reference selection", () => {
  it("appends a batch in order without replacing earlier images", () => {
    const first = file("1.png"); const second = file("2.png");
    expect(appendReferences([first], [second]).files).toEqual([first, second]);
  });
  it("rejects overflow as a whole and tells the user the limit", () => {
    const current = [file("1"), file("2"), file("3")];
    expect(appendReferences(current, [file("4"), file("5")])).toEqual({ files: current, error: expect.stringContaining("最多 4 张") });
  });
  it("rejects invalid files in a batch without silently dropping them", () => {
    const current = [file("1")];
    expect(appendReferences(current, [file("2"), file("bad.txt", "text/plain")])).toEqual({ files: current, error: expect.stringContaining("bad.txt") });
  });
});
