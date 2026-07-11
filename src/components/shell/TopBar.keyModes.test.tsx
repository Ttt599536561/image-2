import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistUserApiConfig } from "../../lib/userApiConfig";
import { ThemeProvider } from "../../lib/theme";
import { TopBar } from "./TopBar";

const state = vi.hoisted(() => ({ customEnabled: true }));

vi.mock("../../hooks/queries", () => ({
  useMe: () => ({
    data: {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "user@example.com",
        role: "user",
        createdAt: "2026-07-11T00:00:00.000Z",
      },
      balanceMp: 100,
      maxConcurrency: 2,
      pricePerImageMp: 70,
      hasPaid: false,
      expiringSoon: { mp: "0", nearestExpiresAt: null },
      customKeyModesEnabled: state.customEnabled,
    },
  }),
  useNotifications: () => ({ data: { items: [] } }),
}));

function renderTopBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider initialTheme="light">
          <TopBar />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TopBar key settings", () => {
  beforeEach(() => {
    localStorage.clear();
    state.customEnabled = true;
  });

  it("shows current system mode and opens the API configuration modal", async () => {
    const user = userEvent.setup();
    renderTopBar();
    const trigger = await screen.findByRole("button", { name: "生图 Key 设置：当前系统 Key" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "API 配置" })).toBeInTheDocument();
  });

  it("shows custom and paused states from the user-scoped config", async () => {
    persistUserApiConfig("00000000-0000-4000-8000-000000000001", {
      mode: "custom",
      apiKey: "fictional-topbar-value",
    });
    const view = renderTopBar();
    expect(await screen.findByRole("button", { name: "生图 Key 设置：当前自定义 Key" })).toBeInTheDocument();
    view.unmount();

    state.customEnabled = false;
    renderTopBar();
    expect(await screen.findByRole("button", { name: "生图 Key 设置：自定义 Key 已暂停" })).toBeInTheDocument();
  });
});
