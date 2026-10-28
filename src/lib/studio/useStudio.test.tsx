import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioHistoryEntry } from "./history";
import { useStudio } from "./useStudio";

const upload = vi.hoisted(() => vi.fn<(file: File) => Promise<string>>());
// Transport retries/integrity are covered in resumable-upload.test; these tests isolate task orchestration.
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), uploadReference: upload }));
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

const session = { ok: true, defaults: { baseUrl: "https://api.tangguo.xin/v1", model: "gpt-image-2" }, limits: { maxPromptLength: 4000, maxUploadBytes: 4194304, maxInflight: 10, maxReferenceImages: 4 } };
beforeEach(() => { localStorage.clear(); history.records = []; history.writes = []; history.failWrites = false; upload.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("studio workflow", () => {
  it("shows and persists a task before uploads finish without polling or exposing the private snapshot", async () => {
    let finishUpload: ((key: string) => void) | undefined;
    upload.mockImplementation(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    const statusCalls: string[] = []; const requests: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ generationId: requests[0].generationId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 });
      }
      if (url.startsWith("/api/studio/status")) { statusCalls.push(url); return Response.json({ items: [], missingIds: [] }); }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "original-secret", rememberKey: false }));
    const params = { prompt: "original cat", size: "auto", model: "gpt-image-2.5-sunburst" } as const;
    const files = [new File(["private-reference"], "original.png", { type: "image/png" })];
    let submitted: boolean | undefined;
    act(() => { void result.current.generate(params, files).then((accepted) => { submitted = accepted; }); });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(submitted).toBe(true);
    expect(result.current.entries[0]).toMatchObject({ status: "queued", localPreparation: true, params });
    expect(result.current.selectedId).toBe(result.current.entries[0].generationId);
    expect(result.current.busy).toBe(true);
    expect(result.current.retryIds).toEqual([]);
    await waitFor(() => expect(history.writes.at(-1)?.[0]).toHaveProperty("localPreparation", true));
    expect(JSON.stringify(history.writes)).not.toMatch(/original-secret|private-reference|original.png|apiKey|inputImageKeys|references/);
    act(() => { window.dispatchEvent(new Event("focus")); files.splice(0); result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "changed-secret", rememberKey: false }); });
    expect(statusCalls).toEqual([]);
    await act(async () => { finishUpload!("studio/session/uploads/original.png"); });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(requests).toEqual([expect.objectContaining({ generationId: result.current.entries[0].generationId, apiKey: "original-secret", ...params, inputImageKeys: ["studio/session/uploads/original.png"] })]);
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].localPreparation).toBeUndefined();
    expect(result.current.retryIds).toEqual([]);
  });

  it.each([true, undefined] as const)("marks an unconfirmed restored task interrupted only after the recovery grace and another miss (preparation: %s)", async (localPreparation) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    history.records = [{ generationId: "a3cb3433-0b76-4c9a-942a-6792c977fd32", createdAt: now - 60_000, params: { prompt: "a cat", size: "auto" }, status: "queued", deadlineAt: "", localPreparation }];
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return Response.json(url === "/api/studio/session" ? session : { items: [], missingIds: [history.records[0].generationId] }); });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(result.current.entries[0].status).toBe("queued");
    now += 29_000;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(result.current.entries[0].status).toBe("queued");
    now += 2_000;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.entries[0]).toMatchObject({ status: "failed", error: { code: "preparation_interrupted" } }));
    expect(result.current.entries[0].error?.message).toContain("中断");
    expect(result.current.retryIds).toEqual([]);
    await act(async () => { await result.current.retry(history.records[0].generationId); });
    expect(calls).toHaveLength(4);
    expect(calls.slice(1).every((url) => url.startsWith("/api/studio/status"))).toBe(true);
  });

  it.each([true, undefined] as const)("recovers a restored unconfirmed task when the server accepts it after an initial miss (preparation: %s)", async (localPreparation) => {
    let statusCalls = 0;
    history.records = [{ generationId: "a3cb3433-0b76-4c9a-942a-6792c977fd32", createdAt: Date.now() - 60_000, params: { prompt: "a cat", size: "auto" }, status: "queued", deadlineAt: "", localPreparation }];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (++statusCalls === 1) return Response.json({ items: [], missingIds: [history.records[0].generationId] });
      return Response.json({ items: [{ generationId: history.records[0].generationId, status: "running", deadlineAt: new Date(Date.now() + 600_000).toISOString() }], missingIds: [] });
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(statusCalls).toBe(1));
    expect(result.current.entries[0].status).toBe("queued");
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.entries[0]?.status).toBe("running"));
    expect(result.current.entries[0].localPreparation).toBeUndefined();
    expect(result.current.entries[0].error).toBeUndefined();
  });

  it("does not send a generation or another upload after the page unmounts", async () => {
    let finishUpload: ((key: string) => void) | undefined;
    upload.mockImplementation(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url === "/api/studio/session") return Response.json(session);
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result, unmount } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "fixture", rememberKey: false }));
    act(() => { void result.current.generate({ prompt: "cat", size: "auto" }, [1, 2].map((n) => new File(["x"], `${n}.png`, { type: "image/png" }))); });
    unmount();
    await act(async () => { finishUpload!("studio/session/uploads/1.png"); });
    expect(calls).toEqual(["/api/studio/session"]);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("ignores stale missingIds for a local preparation and cannot retry it as a text-only task", async () => {
    let statusEvent: ((event: MessageEvent) => void) | undefined;
    let finishUpload: ((key: string) => void) | undefined;
    upload.mockImplementation(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    const submits: Record<string, unknown>[] = [];
    history.records = [{ generationId: "a3cb3433-0b76-4c9a-942a-6792c977fd32", createdAt: Date.now(), params: { prompt: "earlier cat", size: "auto" }, status: "running", deadlineAt: "" }];
    vi.stubGlobal("EventSource", class { addEventListener(_name: string, callback: (event: MessageEvent) => void) { statusEvent = callback; } close() {} });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url.startsWith("/api/studio/status")) return Response.json({ items: [], missingIds: [] });
      submits.push(JSON.parse(String(init?.body)));
      return Response.json({ generationId: submits[0].generationId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 });
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(statusEvent).toBeDefined());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "fixture", rememberKey: false }));
    await act(async () => { await result.current.generate({ prompt: "new cat", size: "auto" }, [new File(["x"], "cat.png", { type: "image/png" })]); });
    const id = result.current.entries[0].generationId;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    await act(async () => { statusEvent!(new MessageEvent("status", { data: JSON.stringify({ items: [], missingIds: [id] }) })); await result.current.retry(id); });
    expect(result.current.entries[0]).toMatchObject({ generationId: id, status: "queued", localPreparation: true });
    expect(submits).toEqual([]);
    await act(async () => { finishUpload!("studio/session/uploads/cat.png"); });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(submits).toEqual([expect.objectContaining({ generationId: id, inputImageKeys: ["studio/session/uploads/cat.png"] })]);
  });

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

  it("keeps an accepted task active when a missing snapshot from before acceptance arrives after a slow upload", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let finishUpload: ((key: string) => void) | undefined;
    upload.mockImplementation(() => new Promise<string>((resolve) => { finishUpload = resolve; }));
    let finishAcceptance: ((response: Response) => void) | undefined;
    let finishMissingStatus: ((response: Response) => void) | undefined;
    let id = ""; let statusCalls = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        id = JSON.parse(String(init?.body)).generationId;
        return new Promise<Response>((resolve) => { finishAcceptance = resolve; });
      }
      if (url.startsWith("/api/studio/status")) {
        if (++statusCalls === 1) return new Promise<Response>((resolve) => { finishMissingStatus = resolve; });
        return Response.json({ items: [{ generationId: id, status: "running", deadlineAt: new Date(now + 600_000).toISOString() }], missingIds: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "fixture", rememberKey: false }));
    await act(async () => { await result.current.generate({ prompt: "cat", size: "auto" }, [new File(["x"], "cat.png", { type: "image/png" })]); });
    now += 31_000;
    await act(async () => { finishUpload!("studio/session/uploads/cat.png"); });
    await waitFor(() => expect(finishMissingStatus).toBeDefined());
    await act(async () => { finishAcceptance!(Response.json({ generationId: id, conversationId: "conversation", status: "queued", deadlineAt: new Date(now + 600_000).toISOString() }, { status: 202 })); });
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () => { finishMissingStatus!(Response.json({ items: [], missingIds: [id] })); });
    expect(result.current.entries[0]).toMatchObject({ generationId: id, status: "queued" });
    expect(result.current.entries[0].error).toBeUndefined();
    expect(result.current.retryIds).toEqual([]);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.entries[0].status).toBe("running"));
  });

  it("still marks a confirmed task unavailable when missing after its server deadline", async () => {
    const id = "a3cb3433-0b76-4c9a-942a-6792c977fd32";
    history.records = [{ generationId: id, createdAt: Date.now() - 700_000, params: { prompt: "cat", size: "auto" }, status: "queued", deadlineAt: new Date(Date.now() - 1_000).toISOString() }];
    vi.stubGlobal("fetch", async (url: string) => Response.json(url === "/api/studio/session" ? session : { items: [], missingIds: [id] }));
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.entries[0]).toMatchObject({ status: "failed", error: { code: "task_unavailable" } }));
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
    act(() => { pending = result.current.generate({ prompt: "a cat", size: "auto" }, []); });
    await waitFor(() => expect(result.current.entries[0]?.status).toBe("failed"));
    await act(async () => { finishAcceptance!(Response.json({ generationId: generatedId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 })); await pending; });
    expect(result.current.entries[0].status).toBe("failed");
    const states = history.writes.map((records) => records[0]?.status);
    expect(states.slice(states.indexOf("failed"))).not.toContain("queued");
    expect(localStorage.getItem("image-studio-connection-v1")).not.toContain("session-secret");
    expect(JSON.stringify(history.writes)).not.toContain("session-secret");
  });

  it.each(["network", "429"])("uploads four ordered references and retries the original model and ids after %s without uploading again", async (failure) => {
    const uploads: string[] = []; const requests: Record<string, unknown>[] = [];
    upload.mockImplementation(async (file) => { uploads.push(file.name); return `studio/session/uploads/${uploads.length}.png`; });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length === 1) {
          if (failure === "429") return Response.json({ error: "queue full, try again later" }, { status: 429 });
          throw new Error("connection lost");
        }
        return Response.json({ generationId: requests[0].generationId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 });
      }
      if (url.startsWith("/api/studio/status")) return Response.json({ items: [], missingIds: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: "https://old.example/v1", apiKey: "fixture", rememberKey: false }));
    await act(async () => { await result.current.generate({ prompt: "cat", size: "auto", model: "gpt-image-2.5-sunburst" }, [1, 2, 3, 4].map((n) => new File(["x"], `${n}.png`, { type: "image/png" }))); });
    await waitFor(() => expect(result.current.retryIds).toHaveLength(1));
    if (failure === "429") expect(result.current.entries[0].status).toBe("failed");
    expect(uploads).toEqual(["1.png", "2.png", "3.png", "4.png"]);
    expect(requests[0]).toMatchObject({ model: "gpt-image-2.5-sunburst", baseUrl: "https://api.tangguo.xin/v1", inputImageKeys: [1, 2, 3, 4].map((n) => `studio/session/uploads/${n}.png`) });
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "other-key", rememberKey: false }));
    await act(async () => { await result.current.retry(result.current.retryIds[0]); });
    expect(requests[1]).toEqual(requests[0]);
    expect(uploads).toHaveLength(4);
    expect(result.current.entries[0].params.model).toBe("gpt-image-2.5-sunburst");
    expect(result.current.entries[0].status).toBe("queued");
    expect(result.current.entries[0].error).toBeUndefined();
    expect(result.current.retryIds).toEqual([]);
  });

  it("retains a failed preparation and retries the original complete ordered image request on the same task", async () => {
    let count = 0; const submits: Record<string, unknown>[] = []; const uploads: string[] = [];
    upload.mockImplementation(async (file) => {
      uploads.push(file.name);
      if (++count === 2) throw new Error("upload retries exhausted");
      return `studio/session/uploads/${file.name}`;
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        submits.push(JSON.parse(String(init?.body)));
        return Response.json({ generationId: submits[0].generationId, conversationId: "conversation", status: "queued", deadlineAt: "date" }, { status: 202 });
      }
      if (url.startsWith("/api/studio/status")) return Response.json({ items: [], missingIds: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "fixture", rememberKey: false }));
    const files = [1, 2, 3, 4].map((n) => new File(["x"], `${n}.png`, { type: "image/png" }));
    const params = { prompt: "cat", size: "auto", model: "gpt-image-2.5-sunburst" } as const;
    await act(async () => { await result.current.generate(params, files); });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(submits).toEqual([]);
    expect(result.current.entries).toHaveLength(1);
    const id = result.current.entries[0].generationId;
    expect(result.current.entries[0]).toMatchObject({ status: "failed", localPreparation: true, error: { code: "preparation_failed" } });
    expect(result.current.retryIds).toEqual([id]);
    files.reverse();
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "other-key", rememberKey: false }));
    await act(async () => { await result.current.retry(id); });
    expect(uploads).toEqual(["1.png", "2.png", "2.png", "3.png", "4.png"]);
    expect(submits).toEqual([expect.objectContaining({ generationId: id, apiKey: "fixture", ...params, inputImageKeys: [1, 2, 3, 4].map((n) => `studio/session/uploads/${n}.png`) })]);
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({ generationId: id, status: "queued" });
    expect(result.current.entries[0].error).toBeUndefined();
    expect(result.current.retryIds).toEqual([]);
  });

  it("lets server confirmation recover a temporary 429 failure after an uncertain submission", async () => {
    let submits = 0; let confirmed = false; let id = "";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/studio/session") return Response.json(session);
      if (url === "/api/studio/generate") {
        id = JSON.parse(String(init?.body)).generationId;
        if (++submits === 1) throw new Error("connection lost after server acceptance");
        return Response.json({ error: "try again later" }, { status: 429 });
      }
      if (url.startsWith("/api/studio/status")) return Response.json(confirmed ? { items: [{ generationId: id, status: "running", deadlineAt: new Date(Date.now() + 600_000).toISOString() }], missingIds: [] } : { items: [], missingIds: [id] });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useStudio());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    act(() => result.current.updateConnection({ baseUrl: session.defaults.baseUrl, apiKey: "fixture", rememberKey: false }));
    await act(async () => { await result.current.generate({ prompt: "cat", size: "auto" }, []); });
    await waitFor(() => expect(result.current.retryIds).toEqual([id]));
    await act(async () => { await result.current.retry(id); });
    expect(result.current.entries[0].status).toBe("failed");
    confirmed = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.entries[0].status).toBe("running"));
    expect(result.current.entries[0].error).toBeUndefined();
    expect(result.current.retryIds).toEqual([]);
    expect(submits).toBe(2);
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
