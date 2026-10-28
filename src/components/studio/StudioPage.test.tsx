import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioHistoryEntry } from "../../lib/studio/history";
import { StudioPage } from "./StudioPage";

const fixture = vi.hoisted(() => ({ entry: null as StudioHistoryEntry | null, prepare: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/studio/referenceCopy", () => ({ prepareReferenceCopy: fixture.prepare }));
vi.mock("../../lib/theme", () => ({ useThemeMode: () => ({ theme: "light", toggle: vi.fn() }) }));
vi.mock("../Toast/ToastProvider", () => ({ useToast: () => ({ info: fixture.info, error: fixture.error, success: vi.fn() }) }));
vi.mock("../Lightbox/LightboxProvider", () => ({ useLightbox: () => ({ open: vi.fn() }) }));
vi.mock("../../lib/studio/useStudio", () => ({ useStudio: () => ({
  connection: { baseUrl: "https://example.com/v1", apiKey: "fixture", rememberKey: false },
  entries: [fixture.entry!], selectedId: fixture.entry!.generationId, ready: true, session: {}, busy: false,
  retryIds: [], setSelectedId: vi.fn(), updateConnection: vi.fn(), clearHistory: vi.fn(), generate: vi.fn(),
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fixture"), revokeObjectURL: vi.fn() }));
  fixture.entry = { generationId: "generated", status: "succeeded", deadlineAt: "", createdAt: 1, params: { prompt: "a transparent cat", size: "auto" }, blob: new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/png" }), image: { id: "image", url: "/api/studio/images/image", width: 1536, height: 1024 } };
});
afterEach(() => vi.unstubAllGlobals());

describe("editing a generated image", () => {
  it("appends selections, supports individual removal, and rejects overflow without losing images", async () => {
    render(<StudioPage />);
    const input = screen.getByLabelText("上传参考图片");
    const files = [1, 2, 3, 4].map((n) => new File(["image"], `${n}.png`, { type: "image/png" }));
    fireEvent.change(input, { target: { files: files.slice(0, 2) } });
    fireEvent.change(input, { target: { files: files.slice(2) } });
    expect(screen.getAllByAltText(/参考图片 \d/)).toHaveLength(4);
    fireEvent.paste(screen.getByRole("textbox", { name: "画面描述" }), { clipboardData: { files: [files[0]] } });
    expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining("最多 4 张"));
    fireEvent.click(screen.getByRole("button", { name: "移除参考图片 2" }));
    expect(screen.getAllByAltText(/参考图片 \d/)).toHaveLength(3);
    expect(screen.queryByText("2.png")).not.toBeInTheDocument();
  });
  it("adds a generated reference copy to existing references", async () => {
    fixture.prepare.mockResolvedValue({ file: new File(["copy"], "generated.webp", { type: "image/webp" }), converted: false });
    render(<StudioPage />);
    fireEvent.change(screen.getByLabelText("上传参考图片"), { target: { files: [new File(["image"], "existing.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "以图编辑" }));
    await waitFor(() => expect(screen.getAllByAltText(/参考图片 \d/)).toHaveLength(2));
    expect(screen.getByText("existing.png")).toBeVisible();
    expect(screen.getByText("generated.webp")).toBeVisible();
  });
  it("blocks repeated preparation and uses only the reference copy without replacing the original", async () => {
    let finish: ((value: { file: File; converted: boolean }) => void) | undefined;
    fixture.prepare.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const original = fixture.entry!.blob;
    render(<StudioPage />);
    fireEvent.click(screen.getByRole("button", { name: "以图编辑" }));
    const pendingButton = await screen.findByRole("button", { name: "准备中…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(fixture.prepare).toHaveBeenCalledTimes(1);
    await act(async () => finish!({ file: new File(["copy"], "参考图_generated.webp", { type: "image/webp" }), converted: true }));
    expect(screen.getByText("参考图_generated.webp")).toBeVisible();
    expect(fixture.entry!.blob).toBe(original);
    expect(fixture.entry!.blob!.size).toBe(4 * 1024 * 1024 + 1);
    expect(fixture.info).toHaveBeenCalledWith("已将大图转换为参考副本，原图不变");
  });
  it("reports failed preparation and lets the user try again", async () => {
    fixture.prepare.mockRejectedValue(new Error("无法生成参考副本，原图不受影响。"));
    render(<StudioPage />);
    fireEvent.click(screen.getByRole("button", { name: "以图编辑" }));
    await waitFor(() => expect(fixture.error).toHaveBeenCalledWith("无法生成参考副本，原图不受影响。"));
    expect(screen.getByRole("button", { name: "以图编辑" })).toBeEnabled();
    expect(screen.queryByAltText("参考图片预览")).not.toBeInTheDocument();
  });
  it("cancels pending preparation on unmount and suppresses late error notifications", async () => {
    let fail: ((error: Error) => void) | undefined;
    fixture.prepare.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { unmount } = render(<StudioPage />);
    fireEvent.click(screen.getByRole("button", { name: "以图编辑" }));
    await waitFor(() => expect(fixture.prepare).toHaveBeenCalledTimes(1));
    const signal = fixture.prepare.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => fail!(new Error("late encoder failure")));
    expect(fixture.error).not.toHaveBeenCalled();
    expect(fixture.info).not.toHaveBeenCalled();
  });
});
