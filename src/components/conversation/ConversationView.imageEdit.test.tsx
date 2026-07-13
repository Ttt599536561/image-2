import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDetail, ConversationGeneration } from "../../contracts/conversation";
import type { MeResponse } from "../../contracts/me";
import { ApiError } from "../../lib/api-client";
import { persistUserApiConfig } from "../../lib/userApiConfig";
import { ThemeProvider } from "../../lib/theme";
import { LightboxProvider } from "../Lightbox/LightboxProvider";
import { ToastProvider } from "../Toast/ToastProvider";
import { ConversationView } from "./ConversationView";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostForm: vi.fn(),
  scrollIntoView: vi.fn(),
}));

const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000010";
const secondConversationId = "00000000-0000-4000-8000-000000000018";
const sourceGenerationId = "00000000-0000-4000-8000-000000000011";
const sourceImageId = "00000000-0000-4000-8000-000000000012";
const childGenerationId = "00000000-0000-4000-8000-000000000013";
const childImageId = "00000000-0000-4000-8000-000000000014";
const failedGenerationId = "00000000-0000-4000-8000-000000000015";
const now = "2026-07-14T00:00:00.000Z";

function meData(): MeResponse {
  return {
    user: {
      id: userId,
      email: "image-edit@example.test",
      role: "user",
      createdAt: now,
    },
    balanceMp: 1_000,
    maxConcurrency: 2,
    pricePerImageMp: 70,
    hasPaid: false,
    customKeyModesEnabled: true,
    expiringSoon: { mp: "0", nearestExpiresAt: null },
  };
}

function turn(overrides: Partial<ConversationGeneration>): ConversationGeneration {
  return {
    id: sourceGenerationId,
    prompt: "source prompt",
    size: "1024x1024",
    quality: "high",
    background: "opaque",
    credentialMode: "system",
    deadlineAt: "2026-07-14T00:05:00.000Z",
    sourceImageId: null,
    sourceImage: null,
    status: "succeeded",
    errorCode: null,
    error: null,
    httpStatus: null,
    creditsChargedMp: 70,
    durationMs: 1_000,
    createdAt: now,
    image: {
      id: sourceImageId,
      publicUrl: "/media/user/source.png",
      width: 1024,
      height: 1024,
      savedToLibrary: false,
    },
    ...overrides,
  };
}

function detail(includeChain = false, includePending = true): ConversationDetail {
  const generations: ConversationGeneration[] = [
    turn({}),
    turn({
      id: "00000000-0000-4000-8000-000000000016",
      prompt: "failed ordinary generation",
      status: "failed",
      errorCode: "unknown",
      error: "failed",
      creditsChargedMp: 0,
      image: null,
    }),
  ];
  if (includePending) {
    generations.push(turn({
      id: "00000000-0000-4000-8000-000000000017",
      prompt: "pending ordinary generation",
      credentialMode: "custom",
      status: "queued",
      creditsChargedMp: 0,
      image: null,
    }));
  }
  if (includeChain) {
    generations.splice(
      1,
      0,
      turn({
        id: childGenerationId,
        prompt: "first edit",
        sourceImageId,
        sourceImage: {
          id: sourceImageId,
          publicUrl: "/media/user/source.png",
          width: 1024,
          height: 1024,
        },
        image: {
          id: childImageId,
          publicUrl: "/media/user/child.png",
          width: 1024,
          height: 1024,
          savedToLibrary: false,
        },
      }),
      turn({
        id: failedGenerationId,
        prompt: "second edit",
        size: "1024x1536",
        quality: "medium",
        background: "transparent",
        sourceImageId: childImageId,
        sourceImage: {
          id: childImageId,
          publicUrl: "/media/user/child.png",
          width: 1024,
          height: 1024,
        },
        status: "failed",
        errorCode: "source_image_unavailable",
        error: "这张图片已不可编辑",
        creditsChargedMp: 0,
        image: null,
      }),
    );
  }
  return {
    id: conversationId,
    title: "image edit",
    createdAt: now,
    updatedAt: now,
    generations,
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
  useGenerationStatuses: () => ({
    data: { items: [], missingIds: [] },
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  }),
}));

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

function renderView(initialDetail = detail()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  mocks.apiGet.mockImplementation(async () =>
    client.getQueryData<ConversationDetail>(["conversation", conversationId]) ?? initialDetail,
  );
  const router = createMemoryRouter(
    [
      {
        path: "/c/:id",
        element: (
          <ConversationView
            conversationId={conversationId}
            initialDetail={initialDetail}
            initialInspirations={[]}
          />
        ),
      },
    ],
    { initialEntries: [`/c/${conversationId}`] },
  );
  render(providers(client, <RouterProvider router={router} />));
  return { client, router };
}

function renderSwitchableView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const details: Record<string, ConversationDetail> = {
    [conversationId]: detail(false, false),
    [secondConversationId]: {
      ...detail(false, false),
      id: secondConversationId,
      title: "second conversation",
      generations: [],
    },
  };
  mocks.apiGet.mockImplementation(async (url: string) => {
    const id = url.split("/").at(-1) ?? "";
    return details[id];
  });

  function RoutedConversationView() {
    const { id = "" } = useParams();
    return (
      <ConversationView
        conversationId={id}
        initialDetail={details[id]}
        initialInspirations={[]}
      />
    );
  }

  const router = createMemoryRouter(
    [{ path: "/c/:id", element: <RoutedConversationView /> }],
    { initialEntries: [`/c/${conversationId}`] },
  );
  render(providers(client, <RouterProvider router={router} />));
  return { client, router };
}

describe("conversation image text editing", () => {
  beforeEach(() => {
    localStorage.clear();
    persistUserApiConfig(userId, { mode: "system", apiKey: "" });
    vi.clearAllMocks();
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
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: mocks.scrollIntoView,
    });
  });

  it("enters an isolated empty edit draft only from a successful image and cancels back to the ordinary draft", async () => {
    const user = userEvent.setup();
    renderView();
    expect(await screen.findAllByRole("button", { name: "编辑图片" })).toHaveLength(1);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "ordinary draft");
    await user.click(screen.getByRole("button", { name: "编辑图片" }));

    expect(textarea).toHaveValue("");
    expect(screen.getByText("正在编辑这张图")).toBeInTheDocument();
    expect(screen.getByText(sourceImageId)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /比例 · 1:1 方形/ })).toBeInTheDocument();
    expect(screen.getByText("系统 Key")).toBeInTheDocument();
    expect(screen.queryByText(/本次消耗/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /参考图/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "高级设置" }));
    expect(screen.getByRole("button", { name: "高" }).className).toContain("segBtnActive");
    expect(screen.getByRole("button", { name: "不透明" }).className).toContain("segBtnActive");

    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(textarea).toHaveValue("ordinary draft");
    expect(screen.queryByText("正在编辑这张图")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
  });

  it("clears the edit source when navigating to another conversation", async () => {
    const user = userEvent.setup();
    const { router } = renderSwitchableView();

    await user.click(await screen.findByRole("button", { name: "编辑图片" }));
    expect(screen.getByText("正在编辑这张图")).toBeInTheDocument();

    await act(async () => {
      await router.navigate(`/c/${secondConversationId}`);
    });

    await waitFor(() => expect(screen.queryByText("正在编辑这张图")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "生成" })).toBeInTheDocument();
  });

  it("retains edit input and parameters on rejection, then closes and scrolls only after 202", async () => {
    const user = userEvent.setup();
    renderView(detail(false, false));
    mocks.apiPost.mockRejectedValueOnce(
      new ApiError(404, "SOURCE_IMAGE_UNAVAILABLE", "这张图片已不可编辑"),
    );

    await user.click(await screen.findByRole("button", { name: "编辑图片" }));
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "make the title green");
    await user.click(screen.getByRole("button", { name: /比例 · 1:1 方形/ }));
    await user.click(screen.getByRole("button", { name: /^2:3 竖图/ }));
    await user.click(screen.getByRole("button", { name: "生成编辑结果" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledOnce());
    expect(textarea).toHaveValue("make the title green");
    expect(screen.getByText("正在编辑这张图")).toBeInTheDocument();
    const rejectedBody = mocks.apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(rejectedBody).toMatchObject({
      prompt: "make the title green",
      size: "1024x1536",
      sourceImageId,
      credentialMode: "system",
    });

    mocks.scrollIntoView.mockClear();
    mocks.apiPost.mockImplementationOnce(async (_url, body) => {
      const request = body as Record<string, unknown>;
      return {
        generationId: String(request.generationId),
        conversationId: String(request.conversationId),
        status: "queued",
        credentialMode: "system",
        deadlineAt: "2026-07-14T00:05:00.000Z",
      };
    });
    await user.click(screen.getByRole("button", { name: "生成编辑结果" }));

    await waitFor(() => expect(screen.queryByText("正在编辑这张图")).not.toBeInTheDocument());
    expect(screen.getAllByText("基于此图编辑").length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.scrollIntoView).toHaveBeenCalled());
  });

  it("shows source ancestry, lets an edited result start the next layer, and retries with the same source", async () => {
    const user = userEvent.setup();
    renderView(detail(true, false));

    expect(await screen.findAllByText("基于此图编辑")).toHaveLength(2);
    const editButtons = screen.getAllByRole("button", { name: "编辑图片" });
    expect(editButtons).toHaveLength(2);
    await user.click(editButtons[1]);
    expect(screen.getAllByText(childImageId)).toHaveLength(2);
    expect(screen.getByRole("textbox")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "取消编辑" }));

    mocks.apiPost.mockImplementationOnce(async (_url, body) => {
      const request = body as Record<string, unknown>;
      return {
        generationId: String(request.generationId),
        conversationId: String(request.conversationId),
        status: "queued",
        credentialMode: "system",
        deadlineAt: "2026-07-14T00:05:00.000Z",
      };
    });
    const unavailableCard = screen.getByText("这张图片已不可编辑").parentElement?.parentElement;
    expect(unavailableCard).not.toBeNull();
    await user.click(within(unavailableCard as HTMLElement).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledOnce());
    expect(mocks.apiPost.mock.calls[0][1]).toMatchObject({
      prompt: "second edit",
      size: "1024x1536",
      quality: "medium",
      background: "transparent",
      sourceImageId: childImageId,
    });
  });
});
