import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LightboxProvider, useLightbox } from "./LightboxProvider";

vi.mock("../Toast/ToastProvider", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
function OpenPreview({ filename }: { filename: string }) {
  const lightbox = useLightbox();
  return <button onClick={() => lightbox.open("blob:fixture", filename)}>打开预览</button>;
}

describe("lightbox copy label", () => {
  it.each([["animation.gif", "复制静态帧"], ["image.png", "复制"]])("describes clipboard output for %s", (filename, label) => {
    render(<LightboxProvider><OpenPreview filename={filename} /></LightboxProvider>);
    fireEvent.click(screen.getByRole("button", { name: "打开预览" }));
    expect(screen.getByRole("button", { name: label })).toBeVisible();
    expect(screen.getByRole("button", { name: "下载" })).toBeVisible();
  });
});
