import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioHistoryEntry } from "./history";
import { useStudio } from "./useStudio";

const history = vi.hoisted(() => ({ records: [] as StudioHistoryEntry[], writes: [] as StudioHistoryEntry[][], failWrites: false }));
vi.mock("./history", async (original) => {
  const actual = await original<typeof import("./history")>();
  return {
    ...actual,
    readHistory: async () => history.records,
    writeHistory: async (records: StudioHistoryEntry[]) => {
      history.writes.push(records.map(actual.historySnapshot));
      if (history.failWrites) throw new Error("quota exceeded");
    },
  };
});

const session = { ok: true, defaults: { baseUrl: "https://api.tangguo.xin/v1", model: "gpt-image-2" }, limits: { maxPromptLength: 4000, maxUploadBytes: 4194304, maxInflight: 10 } };
beforeEach(() => { localStorage.clear(); history.records = []; history.writes = []; history.failWrites = false; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("studio workflow", () => {
  it("restores active ids, then saves the returned original as a Blob without credentials", async () => {
    history.records = [{ generationId: "a3cb3433-0b76-4c9a-942a-6792c977fd32", createdAt: Date.now(), params: { prompt: "a cat", size: "auto" }, status: "queued", deadlineAt: "" }];
    const statusCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url.startsWith("/api/studio/status")) { statusCalls.push(url); return Response.json({ items: [{ generationId: history.records[0].generationId, status: "succeeded", deadlineAt: "", image: { id: "image", url: "/api/studio/images/image", width: 1024, height: 1024 }, durationMs: 2000 }], missingIds: [] }); }
      if (url.endsWith("/api/studio/images/image")) return new Response("original", { headers: { "Content-Type": "image/png" } });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.entries[0]?.blob?.size).toBe(8));
    expect(statusCalls[0]).toContain(history.records[0].generationId);
    await waitFor(() => expect(history.writes.at(-1)?.[0].blob?.size).toBe(8));
    expect(JSON.stringify(history.writes)).not.toMatch(/apiKey|baseUrl/);
  });

  it("preserves completed status when a delayed acceptance arrives after status polling", async () => {
    let finishAcceptance: ((response: Response) => void) | undefined;
    let generatedId = "";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        generatedId = JSON.parse(String(init?.body)).generationId;
        return new Promise<Response>((resolve) => { finishAcceptance = resolve; });
      }
      if (url.startsWith("/api/studio/status")) return Response.json({ items: [{ generationId: generatedId, status: "failed", deadlineAt: "", error: { code: "content_rejected", message: "adjust prompt" } }], missingIds: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: "https://example.com/v1", apiKey: "session-secret", rememberKey: false }));
    let pending: Promise<boolean>;
    act(() => { pending = result.current.generate({ prompt: "a cat", size: "auto" }, null); });
    await waitFor(() => expect(result.current.entries[0]?.status).toBe("failed"));
    await act(async () => { finishAcceptance!(Response.json({ generationId: generatedId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 })); await pending; });
    expect(result.current.entries[0].status).toBe("failed");
    const states = history.writes.map((records) => records[0]?.status);
    expect(states.slice(states.indexOf("failed"))).not.toContain("queued");
    expect(localStorage.getItem("image-studio-connection-v1")).not.toContain("session-secret");
    expect(JSON.stringify(history.writes)).not.toContain("session-secret");
  });

  it("retains the current result and warns when browser persistence fails", async () => {
    history.failWrites = true;
    history.records = [{ generationId: "a3cb3433-0b76-4c9a-942a-6792c977fd32", createdAt: Date.now(), params: { prompt: "a cat", size: "auto" }, status: "succeeded", deadlineAt: "", image: { id: "image", url: "/api/studio/images/image", width: 1024, height: 1024 } }];
    vi.stubGlobal("fetch", async (url: string) => url === "/api/studio/session" ? Response.json(session) : new Response("original", { headers: { "Content-Type": "image/png" } }));
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.notice).toContain("当前结果仍可查看和下载"));
    expect(result.current.entries[0].blob?.size).toBe(8);
  });
});
