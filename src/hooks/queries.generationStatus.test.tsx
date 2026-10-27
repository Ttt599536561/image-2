import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationDetail } from "../contracts/conversation";
import { useConversationDetail } from "./queries";

vi.mock("../lib/api-client", () => ({ apiGet: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const detail: ConversationDetail = {
  id: conversationId, title: "existing", createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z",
  generations: [{ id, prompt: "rejected optimistic job", size: "auto", quality: "high", background: null,
    credentialMode: "custom", deadlineAt: "2026-10-27T00:05:00.000Z", sourceImageId: null, sourceImage: null,
    status: "queued", errorCode: null, error: null, httpStatus: null, creditsChargedMp: 0,
    durationMs: null, createdAt: "2026-10-27T00:00:00.000Z", image: null }],
};

describe("conversation snapshot reconciliation", () => {
  it("does not resurrect an intentionally rolled-back enqueue before its finally cleanup", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["conversation", conversationId], detail);
    client.setQueryData(["generation-active-enqueue-ids"], [id]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useConversationDetail(conversationId), { wrapper });
    act(() => {
      // Mirrors CUSTOM_KEY_MODES_DISABLED rollback while finishEnqueue has not run yet.
      client.setQueryData<ConversationDetail>(["conversation", conversationId], (old) => ({ ...old!, generations: [] }));
    });
    expect(client.getQueryData<ConversationDetail>(["conversation", conversationId])?.generations).toEqual([]);
    hook.unmount(); client.clear();
  });
});
