import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../../src/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    code = "INTERNAL";
  },
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

import SystemUpdatePage from "./_admin.system-update";

const REQUEST_STORAGE_KEY = "ai-image-workshop:update-request";
const REQUEST_ID = "26e972ea-37e0-4361-8d03-52130c1c241b";
const snapshot = {
  enabled: true,
  disabledReason: null,
  build: {
    version: "0.2.1",
    commitSha: "unknown",
    shortCommitSha: "unknown",
  },
  status: {
    protocolVersion: 1,
    requestId: null,
    currentVersion: "0.2.1",
    targetVersion: null,
    phase: "idle",
    maintenance: false,
    startedAt: null,
    finishedAt: null,
    updatedAt: "2026-07-14T13:00:00.000Z",
    errorCode: null,
    errorMessage: null,
    backupId: null,
    recoveryCommand: null,
  },
  releaseState: "available",
  latestRelease: {
    tag: "v0.2.2",
    version: "0.2.2",
    name: "v0.2.2",
    summary: "System updater validation hotfix.",
    htmlUrl: "https://github.com/Ttt599536561/image-2/releases/tag/v0.2.2",
    publishedAt: "2026-07-14T13:00:00.000Z",
  },
};

describe("admin system update pending state", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.apiGet.mockReset().mockResolvedValue(snapshot);
    mocks.apiPost.mockReset();
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it("shows an accepted request while the host updater still reports idle", async () => {
    sessionStorage.setItem(REQUEST_STORAGE_KEY, REQUEST_ID);

    render(<SystemUpdatePage />);

    expect(
      await screen.findByText("更新请求已提交，等待主机更新器接收"),
    ).toBeInTheDocument();
    expect(screen.getByText(REQUEST_ID)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled(),
    );
  });
});
