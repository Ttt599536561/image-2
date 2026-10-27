import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CosmicSkeleton } from "./CosmicSkeleton";

afterEach(() => { vi.useRealTimers(); });

it("hydrates pending image timers without rebuilding the tree when time advances", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(12_000);
  const container = document.createElement("div");
  container.innerHTML = renderToString(<CosmicSkeleton size="auto" startedAt={1_000} />);
  document.body.append(container);
  vi.setSystemTime(15_000);
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => { root = hydrateRoot(container, <CosmicSkeleton size="auto" startedAt={1_000} />, { onRecoverableError: recoverable }); });
  try {
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.querySelector('[role="img"]')).toHaveAttribute("aria-label", "生成中 0:14");
  } finally {
    await act(async () => { root!.unmount(); });
    container.remove();
  }
});
