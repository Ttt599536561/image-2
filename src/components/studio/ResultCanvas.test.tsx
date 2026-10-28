import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StudioHistoryEntry } from "../../lib/studio/history";
import { ResultCanvas } from "./ResultCanvas";

vi.mock("../Lightbox/LightboxProvider", () => ({ useLightbox: () => ({ open: vi.fn() }) }));

const pending: StudioHistoryEntry = { generationId: "pending", createdAt: Date.now(), params: { prompt: "cat", size: "auto" }, deadlineAt: "", status: "queued", localPreparation: true };
function canvas(entry: StudioHistoryEntry, retryable = false) {
  const retry = vi.fn();
  render(<ResultCanvas entry={entry} entries={[entry]} onSelect={vi.fn()} onReuse={vi.fn()} onEdit={vi.fn()} preparingReference={false} onConnect={vi.fn()} hasConnection retryable={retryable} onRetry={retry} busy={false} />);
  return retry;
}

describe("immediate task presentation", () => {
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
