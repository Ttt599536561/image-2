import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDetail } from "../../contracts/conversation";
import type { MeResponse } from "../../contracts/me";
import { ApiError } from "../../lib/api-client";
import { loadUserApiConfig, persistUserApiConfig } from "../../lib/userApiConfig";
import { ThemeProvider } from "../../lib/theme";
import { LightboxProvider } from "../Lightbox/LightboxProvider";
import { ToastProvider } from "../Toast/ToastProvider";
import { ConversationView } from "./ConversationView";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiPostForm: vi.fn(),
  apiGet: vi.fn(),
  statusRefetch: vi.fn(),
  customEnabled: true,
  returnMissing: false,
}));

const userId = "00000000-0000-4000-8000-000000000001";

function meData(): MeResponse {
  return {
    user: {
      id: userId,
      email: "route-test@example.test",
      role: "user",
      createdAt: "2026-07-11T12:00:00.000Z",
    },
    balanceMp: 0,
    maxConcurrency: 2,
    pricePerImageMp: 70,
    hasPaid: false,
    customKeyModesEnabled: mocks.customEnabled,
    expiringSoon: { mp: "0", nearestExpiresAt: null },
  };
}

vi.mock("../../lib/api-client", async () => ({
  ...(await vi.importActual("../../lib/api-client")),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiPostForm: mocks.apiPostForm,
}));

vi.mock("../../hooks/queries", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/queries")>("../../hooks/queries");
  return {
    ...actual,
    useMe: () =>
      useQuery({
        queryKey: ["me", "balance"],
        queryFn: async () => meData(),
        initialData: meData,
        staleTime: Number.POSITIVE_INFINITY,
      }),
    useNotifications: () => ({ data: { items: [] } }),
  };
});

vi.mock("../../hooks/useGenerationStatus", () => ({
  useGenerationStatuses: (ids: string[]) => {
    const tick = useQuery({
      queryKey: ["test-status-tick"],
      queryFn: async () => 0,
      initialData: 0,
      enabled: false,
    });
    return {
      data: { items: [], missingIds: mocks.returnMissing ? ids : [] },
      dataUpdatedAt: tick.data,
      refetch: mocks.statusRefetch,
    };
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function HomeRoute() {
  return <ConversationView conversationId={null} initialInspirations={[]} />;
}

function ConversationRoute({ client }: { client: QueryClient }) {
  const { id = "" } = useParams();
  const initialDetail = client.getQueryData<ConversationDetail>(["conversation", id]);
  return <ConversationView conversationId={id} initialDetail={initialDetail} />;
}

function providers(client: QueryClient, children: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider initialTheme="light">
        <ToastProvider>
          <LightboxProvider>{children}</LightboxProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function renderConversationRoutes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const router = createMemoryRouter(
    [
      { path: "/", element: <HomeRoute /> },
      { path: "/c/:id", element: <ConversationRoute client={client} /> },
    ],
    { initialEntries: ["/"] },
  );
  render(providers(client, <RouterProvider router={router} />));
  return { client, router };
}

describe("ConversationView key-mode route integration", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    mocks.apiPost.mockReset();
    mocks.apiPostForm.mockReset();
    mocks.apiGet.mockReset();
    mocks.statusRefetch.mockReset();
    mocks.customEnabled = true;
    mocks.returnMissing = false;
    persistUserApiConfig(userId, { mode: "custom", apiKey: "fictional-route-value" });
  });

  it("keeps the remounted conversation composer locked until the first enqueue reaches 202", async () => {
    const accepted = deferred<Record<string, unknown>>();
    mocks.apiPost.mockReturnValueOnce(accepted.promise);
    mocks.returnMissing = true;
    const user = userEvent.setup();
    const { client, router } = renderConversationRoutes();

    const textarea = await screen.findByRole("textbox");
    await waitFor(() => expect(textarea).toBeEnabled());
    await user.type(textarea, "跨路由入队锁");
    await user.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/[0-9a-f-]+$/i));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox")).toBeDisabled();
    await act(async () => {
      client.setQueryData(["test-status-tick"], 1);
      await Promise.resolve();
    });
    await act(async () => {
      client.setQueryData(["test-status-tick"], 2);
      await Promise.resolve();
    });
    expect(mocks.apiGet).not.toHaveBeenCalled();

    const requestBody = mocks.apiPost.mock.calls[0][1] as Record<string, unknown>;
    await act(async () => {
      accepted.resolve({
        generationId: String(requestBody.generationId),
        conversationId: String(requestBody.conversationId),
        status: "queued",
        credentialMode: "custom",
        deadlineAt: "2026-07-11T12:05:00.000Z",
      });
      await accepted.promise;
    });

    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
  });

  it("returns from a first-submit 503 into the paused modal without losing the saved key", async () => {
    const rejected = deferred<never>();
    mocks.apiPost.mockReturnValueOnce(rejected.promise);
    const user = userEvent.setup();
    const { client, router } = renderConversationRoutes();

    const textarea = await screen.findByRole("textbox");
    await waitFor(() => expect(textarea).toBeEnabled());
    await user.type(textarea, "首次暂停回滚");
    await user.click(screen.getByRole("button", { name: "生成" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/c\/[0-9a-f-]+$/i));

    mocks.customEnabled = false;
    await act(async () => {
      rejected.reject(new ApiError(503, "CUSTOM_KEY_MODES_DISABLED", "自定义 Key 模式暂不可用"));
      await rejected.promise.catch(() => undefined);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByRole("dialog", { name: "API 配置" })).toBeInTheDocument();
    expect(screen.getByText("自定义 Key 暂停使用，可切换系统 Key")).toBeInTheDocument();
    expect(loadUserApiConfig(userId)).toEqual({
      mode: "custom",
      apiKey: "fictional-route-value",
    });
    expect(client.getQueryData<MeResponse>(["me", "balance"])?.customKeyModesEnabled).toBe(false);
    expect(mocks.apiPost).toHaveBeenCalledOnce();
  });
});
