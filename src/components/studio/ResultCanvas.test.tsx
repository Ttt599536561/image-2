import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImage } from "../../lib/download";
import type { StudioHistoryEntry } from "../../lib/studio/history";
import { ResultCanvas } from "./ResultCanvas";

const openLightbox = vi.hoisted(() => vi.fn());
vi.mock("../Lightbox/LightboxProvider", () => ({ useLightbox: () => ({ open: openLightbox }) }));
vi.mock("../../lib/download", () => ({ downloadImage: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const pending: StudioHistoryEntry = { generationId: "pending", createdAt: Date.now(), params: { prompt: "cat", size: "auto" }, deadlineAt: "", status: "queued", localPreparation: true };
function canvas(entry: StudioHistoryEntry, retryable = false) {
  const retry = vi.fn();
  render(<ResultCanvas entry={entry} entries={[entry]} onSelect={vi.fn()} onReuse={vi.fn()} onEdit={vi.fn()} preparingReference={false} onConnect={vi.fn()} hasConnection retryable={retryable} onRetry={retry} busy={false} />);
  return retry;
}

describe("immediate task presentation", () => {
  it.each([
    ["image/png", "PNG", "png"],
    ["image/jpeg", "JPEG", "jpg"],
    ["image/webp", "WebP", "webp"],
  ] as const)("shows %s returned for a GIF request before the Blob is saved", (contentType, label, ext) => {
    const image = { id: "test", url: "/api/studio/images/test", width: 1, height: 1, contentType };
    canvas({ ...pending, status: "succeeded", params: { ...pending.params, outputFormat: "gif" }, image });
    expect(screen.getByRole("status")).toHaveTextContent(`请求 GIF，实际返回 ${label}。已保留原图。`);
    expect(screen.queryByText("GIF 动图")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
    expect(downloadImage).toHaveBeenCalledWith(image.url, `图像工坊_pending.${ext}`);
    fireEvent.click(screen.getByRole("button", { name: "放大查看生成图片" }));
    expect(openLightbox).toHaveBeenCalledWith(image.url, `图像工坊_pending.${ext}`);
  });
  it.each([true, false])("downloads GIF without converting it and does not offer static reference editing (local Blob: %s)", (local) => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:animated"), revokeObjectURL: vi.fn() }));
    const entry: StudioHistoryEntry = { ...pending, status: "succeeded", params: { ...pending.params, model: "gpt-image-2.6", outputFormat: "gif" }, image: { id: "gif", url: "/api/studio/images/gif", width: 1, height: 1 }, ...(local ? { blob: new Blob(["GIF89a"], { type: "image/gif" }) } : {}) };
    canvas(entry);
    const src = local ? "blob:animated" : "/api/studio/images/gif";
    expect(screen.getByRole("img", { name: "cat" })).toHaveAttribute("src", src);
    expect(screen.queryByRole("button", { name: "以图编辑" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载原图" }));
    expect(downloadImage).toHaveBeenCalledWith(src, "图像工坊_pending.gif");
  });
  it("explains the longer GIF generation budget", () => {
    canvas({ ...pending, params: { ...pending.params, outputFormat: "gif" } });
    expect(screen.getByText(/GIF 动图.*10 分钟/)).toBeVisible();
  });
  it("shows a submitted task without exposing background upload details", () => {
    canvas(pending);
    expect(screen.getByRole("heading", { name: "任务已提交" })).toBeVisible();
    expect(screen.getByText("正在处理，完成后会在这里更新结果。")).toBeVisible();
    expect(screen.queryByText(/上传|等待确认/)).not.toBeInTheDocument();
  });
  it("lets a failed preparation retry on the same task", () => {
    const retry = canvas({ ...pending, status: "failed", error: { code: "preparation_failed", message: "任务暂未完成，请重试此任务。" } }, true);
    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
