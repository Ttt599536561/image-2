import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerPanel } from "./ComposerPanel";

describe("studio composer keyboard submission", () => {
  it("describes accepted background work without showing upload or submission steps", () => {
    render(<ComposerPanel params={{ prompt: "cat", size: "auto" }} onParams={vi.fn()} references={[]} onReferences={vi.fn()} onRemoveReference={vi.fn()} onGenerate={vi.fn()} busy enabled hasConnection connectionLabel="example.com" onConnection={vi.fn()} />);
    expect(screen.getByRole("button", { name: /正在处理/ })).toBeDisabled();
    expect(screen.queryByText(/上传并提交中|正在提交/)).not.toBeInTheDocument();
  });
  it("uses modifier Enter only and does not submit during IME composition", () => {
    const generate = vi.fn();
    render(<ComposerPanel params={{ prompt: "一只猫", size: "auto", quality: "auto", background: "auto" }} onParams={vi.fn()} references={[]} onReferences={vi.fn()} onRemoveReference={vi.fn()} onGenerate={generate} busy={false} enabled hasConnection connectionLabel="example.com" onConnection={vi.fn()} />);
    const prompt = screen.getByRole("textbox", { name: "画面描述" });
    fireEvent.keyDown(prompt, { key: "Enter" });
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true, isComposing: true });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true, keyCode: 229 });
    expect(generate).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("shows all six real sizes and distinguishes quality from dimensions", () => {
    render(<ComposerPanel params={{ prompt: "", size: "auto" }} onParams={vi.fn()} references={[]} onReferences={vi.fn()} onRemoveReference={vi.fn()} onGenerate={vi.fn()} busy={false} enabled hasConnection connectionLabel="example.com" onConnection={vi.fn()} />);
    expect(screen.getByText("1024 × 1536")).toBeVisible();
    expect(screen.getByText("1920 × 1088")).toBeVisible();
    expect(screen.getByLabelText("生成质量")).toBeVisible();
    expect(screen.queryByText("4K")).not.toBeInTheDocument();
  });
  it("exposes both models, always-visible background, and all clipboard files", () => {
    const change = vi.fn(); const add = vi.fn();
    render(<ComposerPanel params={{ prompt: "", size: "auto", model: "gpt-image-2" }} onParams={change} references={[]} onReferences={add} onRemoveReference={vi.fn()} onGenerate={vi.fn()} busy={false} enabled hasConnection connectionLabel="api.tangguo.xin" onConnection={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "生成模型" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-image-2.5-sunburst" }));
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-image-2.5-sunburst" }));
    expect(screen.getByRole("combobox", { name: "图片背景" })).toBeVisible();
    const files = [new File(["1"], "1.png", { type: "image/png" }), new File(["2"], "2.png", { type: "image/png" })];
    fireEvent.paste(screen.getByRole("textbox", { name: "画面描述" }), { clipboardData: { files } });
    expect(add).toHaveBeenCalledWith(files);
  });
});
