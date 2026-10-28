import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferenceImage } from "./ReferenceImage";

beforeEach(() => {
  let id = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => `blob:reference-${++id}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());
describe("reference thumbnails", () => {
  it("releases object URLs when images are removed and the panel unmounts", () => {
    const one = new File(["1"], "one.png", { type: "image/png" });
    const two = new File(["2"], "two.png", { type: "image/png" });
    const props = { onAdd: vi.fn(), onRemove: vi.fn() };
    const { rerender, unmount } = render(<ReferenceImage {...props} files={[one, two]} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    rerender(<ReferenceImage {...props} files={[one]} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference-2");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference-1");
  });
  it("sends every dropped file to validation even when a thumbnail is already present", () => {
    const files = [new File(["1"], "one.png", { type: "image/png" }), new File(["bad"], "invalid.txt", { type: "text/plain" })];
    const add = vi.fn();
    render(<ReferenceImage files={[files[0]]} onAdd={add} onRemove={vi.fn()} />);
    fireEvent.drop(screen.getByAltText("参考图片 1"), { dataTransfer: { files } });
    expect(add).toHaveBeenCalledWith(files);
  });
});
