import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationDetail } from "../contracts/conversation";
import type { GenerateAccepted, SourceImageSummary } from "../contracts/generate";
import type { MeResponse } from "../contracts/me";
import { ApiError } from "../lib/api-client";
import { useGeneration } from "./useGeneration";

const mocks = vi.hoisted(() => ({ apiPost: vi.fn(), apiPostForm: vi.fn() }));

vi.mock("../lib/api-client", async () => ({
  ...(await vi.importActual("../lib/api-client")),
  apiPost: mocks.apiPost,
  apiPostForm: mocks.apiPostForm,
}));

const params = { prompt: "hook prompt", size: "auto" as const, quality: "auto" as const };

function setup(onError?: (error: ApiError) => void, conversationId: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useGeneration(conversationId, { onError }), { wrapper }) };
}

describe("useGeneration credential snapshot", () => {
  beforeEach(() => {
    mocks.apiPost.mockReset();
    mocks.apiPostForm.mockReset();
  });

  it("sends custom key without a base URL and waits for 202 before accepting", async () => {
    let resolveAccepted!: (value: GenerateAccepted) => void;
    mocks.apiPost.mockReturnValueOnce(
      new Promise<GenerateAccepted>((resolve) => {
        resolveAccepted = resolve;
      }),
    );
    const onAccepted = vi.fn();
    const { result, queryClient } = setup();

    act(() => {
      result.current.submit(
        params,
        { mode: "custom", apiKey: "fictional-hook-value" },
        { onAccepted },
      );
    });
    expect(onAccepted).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1));
    const requestBody = mocks.apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      credentialMode: "custom",
      customApiKey: "fictional-hook-value",
    });
    expect(requestBody).not.toHaveProperty("baseUrl");

    const accepted: GenerateAccepted = {
      generationId: String(requestBody.generationId),
      conversationId: String(requestBody.conversationId),
      status: "queued",
      credentialMode: "custom",
      deadlineAt: "2026-07-11T12:05:00.000Z",
    };
    resolveAccepted(accepted);
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted));
    const cached = queryClient.getQueryData<ConversationDetail>([
      "conversation",
      accepted.conversationId,
    ]);
    expect(cached?.generations[0]).toMatchObject({
      credentialMode: "custom",
      deadlineAt: accepted.deadlineAt,
    });
  });

  it("never sends a custom key in system mode", async () => {
    mocks.apiPost.mockResolvedValueOnce({
      generationId: "00000000-0000-4000-8000-000000000010",
      conversationId: "00000000-0000-4000-8000-000000000011",
      status: "queued",
      credentialMode: "system",
      deadlineAt: "2026-07-11T12:05:00.000Z",
    });
    const { result } = setup();
    act(() => result.current.submit(params, { mode: "system", apiKey: "fictional-saved-but-unused" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalled());
    const requestBody = mocks.apiPost.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(requestBody.credentialMode).toBe("system");
    expect(requestBody).not.toHaveProperty("customApiKey");
  });

  it("sends only the source id while preserving the safe summary in the optimistic turn", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000020";
    const sourceImageId = "00000000-0000-4000-8000-000000000021";
    const sourceImage: SourceImageSummary = {
      id: sourceImageId,
      publicUrl: "/media/user/source.png",
      width: 1024,
      height: 1024,
    };
    let resolveAccepted!: (value: GenerateAccepted) => void;
    mocks.apiPost.mockReturnValueOnce(
      new Promise<GenerateAccepted>((resolve) => {
        resolveAccepted = resolve;
      }),
    );
    const onAccepted = vi.fn();
    const { result, queryClient } = setup(undefined, conversationId);
    queryClient.setQueryData<ConversationDetail>(["conversation", conversationId], {
      id: conversationId,
      title: "existing",
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z",
      generations: [
        {
          id: "00000000-0000-4000-8000-000000000022",
          prompt: "source",
          size: "1024x1024",
          quality: "auto",
          background: "auto",
          credentialMode: "system",
          deadlineAt: "2026-07-11T12:05:00.000Z",
          sourceImageId: null,
          sourceImage: null,
          status: "succeeded",
          errorCode: null,
          error: null,
          httpStatus: null,
          creditsChargedMp: 70,
          durationMs: 1_000,
          createdAt: "2026-07-11T12:00:00.000Z",
          image: { ...sourceImage, savedToLibrary: false },
        },
      ],
    });

    act(() => {
      result.current.submit(params, { mode: "system", apiKey: "unused" }, {
        source: { sourceImageId, sourceImage },
        onAccepted,
      });
    });

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledOnce());
    const requestBody = mocks.apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(requestBody).toMatchObject({ sourceImageId, credentialMode: "system" });
    expect(requestBody).not.toHaveProperty("sourceImage");
    expect(JSON.stringify(requestBody)).not.toContain(sourceImage.publicUrl);
    expect(mocks.apiPostForm).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<ConversationDetail>(["conversation", conversationId])?.generations.at(-1),
    ).toMatchObject({ sourceImageId, sourceImage });
    expect(onAccepted).not.toHaveBeenCalled();

    const accepted: GenerateAccepted = {
      generationId: String(requestBody.generationId),
      conversationId,
      status: "queued",
      credentialMode: "system",
      deadlineAt: "2026-07-11T12:05:00.000Z",
    };
    resolveAccepted(accepted);
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted));
  });

  it("maps an unavailable edit source onto the optimistic failed turn", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000030";
    const sourceImageId = "00000000-0000-4000-8000-000000000031";
    const sourceImage: SourceImageSummary = {
      id: sourceImageId,
      publicUrl: "/media/user/source.png",
      width: 1024,
      height: 1024,
    };
    mocks.apiPost.mockRejectedValueOnce(
      new ApiError(404, "SOURCE_IMAGE_UNAVAILABLE", "这张图片已不可编辑"),
    );
    const { result, queryClient } = setup(undefined, conversationId);
    queryClient.setQueryData<ConversationDetail>(["conversation", conversationId], {
      id: conversationId,
      title: "existing",
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z",
      generations: [],
    });

    act(() => {
      result.current.submit(params, { mode: "system", apiKey: "" }, {
        source: { sourceImageId, sourceImage },
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ConversationDetail>(["conversation", conversationId])
          ?.generations.at(-1),
      ).toMatchObject({
        status: "failed",
        errorCode: "source_image_unavailable",
        error: "这张图片已不可编辑",
      });
    });
  });

  it("fully rolls back a new optimistic conversation when custom mode is disabled", async () => {
    mocks.apiPost.mockRejectedValueOnce(
      new ApiError(503, "CUSTOM_KEY_MODES_DISABLED", "自定义 Key 模式暂不可用"),
    );
    const onError = vi.fn();
    const { result, queryClient } = setup(onError);
    queryClient.setQueryData(["conversations", "all"], { items: [], total: 0 });
    const me: MeResponse = {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "local@example.test",
        role: "user",
        createdAt: "2026-07-11T12:00:00.000Z",
      },
      balanceMp: 0,
      maxConcurrency: 2,
      pricePerImageMp: 1000,
      hasPaid: false,
      customKeyModesEnabled: true,
      expiringSoon: { mp: "0", nearestExpiresAt: null },
    };
    queryClient.setQueryData(["me", "balance"], me);

    act(() => {
      result.current.submit(params, { mode: "custom", apiKey: "fictional-disabled-value" });
    });

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const requestBody = mocks.apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(
      queryClient.getQueryData(["conversation", String(requestBody.conversationId)]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["conversations", "all"])).toEqual({ items: [], total: 0 });
    expect(queryClient.getQueryData<MeResponse>(["me", "balance"])?.customKeyModesEnabled).toBe(false);
  });
});
