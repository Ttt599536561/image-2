import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerPanel } from "./ComposerPanel";

describe("studio composer keyboard submission", () => {
  it("uses modifier Enter only and does not submit during IME composition", () => {
    const generate = vi.fn();
    render(<ComposerPanel params={{ prompt: "一只猫", size: "auto", quality: "auto", background: "auto" }} onParams={vi.fn()} reference={null} onReference={vi.fn()} onGenerate={generate} busy={false} enabled hasConnection connectionLabel="example.com" onConnection={vi.fn()} />);
    const prompt = screen.getByRole("textbox", { name: "画面描述" });
    fireEvent.keyDown(prompt, { key: "Enter" });
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true, keyCode: 229 });
    expect(generate).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("shows all six real sizes and distinguishes quality from dimensions", () => {
    render(<ComposerPanel params={{ prompt: "", size: "auto" }} onParams={vi.fn()} reference={null} onReference={vi.fn()} onGenerate={vi.fn()} busy={false} enabled hasConnection connectionLabel="example.com" onConnection={vi.fn()} />);
    expect(screen.getByText("1024 × 1536")).toBeVisible();
    expect(screen.getByText("1920 × 1088")).toBeVisible();
    expect(screen.getByLabelText("生成质量")).toBeVisible();
    expect(screen.queryByText("4K")).not.toBeInTheDocument();
  });
});
