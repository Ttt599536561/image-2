import { useCallback, useEffect, useRef, useState } from "react";
import { StudioGenerateRequest, type StudioParams, type StudioSessionInfo, type StudioStatusBatch } from "../../contracts/studio";
import { DEFAULT_CONNECTION, loadConnection, saveConnection, type StudioConnection } from "./connection";
import { fetchResultBlob, getStudioSession, getStudioStatus, StudioApiError, submitGeneration, uploadReference } from "./api";
import { isActive, pickParams, pruneHistory, readHistory, writeHistory, type StudioHistoryEntry } from "./history";
import { appendReferences } from "./references";

const STORAGE_WARNING = "此浏览器未能保存历史。当前结果仍可查看和下载，请及时下载原图。";
export function useStudio() {
  const [connection, setConnection] = useState<StudioConnection>({ ...DEFAULT_CONNECTION });
  const [entries, setEntries] = useState<StudioHistoryEntry[]>([]);
  const entriesRef = useRef(entries);
  const [session, setSession] = useState<StudioSessionInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [streamOffline, setStreamOffline] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Retry requests are held in memory only; credentials never enter history.
  const retryRequests = useRef(new Map<string, StudioGenerateRequest>());
  const [retryIds, setRetryIds] = useState<string[]>([]);
  const downloading = useRef(new Set<string>());
  const saveQueue = useRef(Promise.resolve());
  const mounted = useRef(true);

  const commit = useCallback((update: (current: StudioHistoryEntry[]) => StudioHistoryEntry[]) => {
    const next = pruneHistory(update(entriesRef.current));
    entriesRef.current = next;
    setEntries(next);
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => writeHistory(next)).catch(() => {
      if (mounted.current) setNotice(STORAGE_WARNING);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    try { setConnection(loadConnection(window.localStorage)); } catch { setNotice("无法读取连接设置；Key 只在当前页面使用。"); }
    void readHistory().then((saved) => {
      if (!mounted.current) return;
      entriesRef.current = saved;
      setEntries(saved);
      setSelectedId(saved[0]?.generationId ?? null);
    }).catch(() => setNotice(STORAGE_WARNING)).finally(() => setReady(true));
    void getStudioSession().then(setSession).catch(() => setError("连接工作台失败，请检查网络后重连。"));
    return () => { mounted.current = false; };
  }, []);

  const updateConnection = useCallback((next: StudioConnection) => {
    const fixed = { ...next, baseUrl: DEFAULT_CONNECTION.baseUrl };
    setConnection(fixed);
    try { saveConnection(fixed, window.localStorage); }
    catch { setNotice("连接设置未能保存在此浏览器，当前页面仍可使用。"); }
  }, []);

  const receive = useCallback((batch: StudioStatusBatch) => {
    if (!Array.isArray(batch.items) || !Array.isArray(batch.missingIds)) return;
    commit((current) => current.map((entry) => {
      const update = batch.items.find((item) => item.generationId === entry.generationId);
      if (update) {
        retryRequests.current.delete(entry.generationId);
        const rank = { queued: 0, claimed: 1, running: 2, succeeded: 3, failed: 3 };
        if (rank[update.status] < rank[entry.status] || (!isActive(entry) && update.status !== entry.status)) return entry;
        return { ...entry, ...update };
      }
      if (batch.missingIds.includes(entry.generationId) && !retryRequests.current.has(entry.generationId) && Date.now() - entry.createdAt > 30_000 && isActive(entry)) {
        return { ...entry, status: "failed", error: { code: "task_unavailable", message: "此任务已不可查询，可能已过期或浏览器会话已清除。" } };
      }
      return entry;
    }));
    setRetryIds([...retryRequests.current.keys()]);
  }, [commit]);

  const activeIds = entries.filter(isActive).map((entry) => entry.generationId).sort().join(",");
  useEffect(() => {
    if (!activeIds || !session) return;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const batch = await getStudioStatus(activeIds.split(","));
        if (!stopped) { receive(batch); setStreamOffline(false); }
      } catch { if (!stopped) setStreamOffline(true); }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    let stream: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      stream = new EventSource(`/api/studio/events?ids=${encodeURIComponent(activeIds)}`);
      stream.addEventListener("status", (event) => {
        try { receive(JSON.parse((event as MessageEvent).data)); setStreamOffline(false); } catch { /* Polling recovers invalid or interrupted events. */ }
      });
      stream.onerror = () => setStreamOffline(true);
    }
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => { stopped = true; clearInterval(timer); stream?.close(); window.removeEventListener("focus", onFocus); };
  }, [activeIds, session, receive]);

  useEffect(() => {
    for (const entry of entries) {
      if (entry.status !== "succeeded" || !entry.image || entry.blob || downloading.current.has(entry.generationId)) continue;
      downloading.current.add(entry.generationId);
      void fetchResultBlob(entry.image.url).then((blob) => {
        if (mounted.current) commit((current) => current.map((item) => item.generationId === entry.generationId ? { ...item, blob } : item));
      }).catch(() => { if (mounted.current) setNotice("原图暂未保存到本机，请使用下载原图保存；重新打开页面可再次尝试。"); });
    }
  }, [entries, commit]);

  const send = useCallback(async (request: StudioGenerateRequest) => {
    retryRequests.current.set(request.generationId, request);
    try {
      const accepted = await submitGeneration(request);
      retryRequests.current.delete(request.generationId);
      commit((current) => current.map((entry) => entry.generationId === request.generationId ? { ...entry, conversationId: accepted.conversationId, deadlineAt: accepted.deadlineAt } : entry));
      setError("");
      return true;
    } catch (cause) {
      if (cause instanceof StudioApiError && cause.status < 500) {
        retryRequests.current.delete(request.generationId);
        const message = cause.message;
        commit((current) => current.map((entry) => entry.generationId === request.generationId ? { ...entry, status: "failed", error: { code: "request_rejected", message } } : entry));
        setError(message);
      } else {
        setError("网络中断，尚未确认任务是否受理。可点击“确认并重试”，将使用同一任务 ID，避免重复生成。");
      }
      return false;
    } finally { setRetryIds([...retryRequests.current.keys()]); }
  }, [commit]);

  const generate = useCallback(async (params: StudioParams, references: File[]): Promise<boolean> => {
    if (submitting.current || !ready || !session) return false;
    const validation = appendReferences([], references);
    if (validation.error) { setError(validation.error); return false; }
    const parsed = StudioGenerateRequest.safeParse({ ...pickParams(params), baseUrl: DEFAULT_CONNECTION.baseUrl, apiKey: connection.apiKey, generationId: crypto.randomUUID() });
    if (!parsed.success) {
      setError(!connection.apiKey.trim() ? "请先在连接设置中填写 API Key。" : !params.prompt.trim() ? "请先写下你想生成的画面。" : "请检查生成参数，提示词最多 4000 字。");
      return false;
    }
    submitting.current = true; setBusy(true); setError("");
    try {
      const request = parsed.data;
      if (references.length) {
        const keys: string[] = [];
        // At most four sequential uploads preserve order and stop at the first failure.
        for (const reference of references) keys.push(await uploadReference(reference));
        request.inputImageKeys = keys;
      }
      const entry: StudioHistoryEntry = { generationId: request.generationId, params: pickParams(request), createdAt: Date.now(), deadlineAt: "", status: "queued" };
      // Keep the request before exposing its id to polling; it may not be accepted yet.
      retryRequests.current.set(request.generationId, request);
      commit((current) => [entry, ...current]);
      setSelectedId(entry.generationId);
      return await send(request);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "参考图上传失败，请重试。"); return false; }
    finally { submitting.current = false; setBusy(false); }
  }, [connection, ready, session, commit, send]);

  const retry = async (id: string) => {
    const request = retryRequests.current.get(id);
    if (!request || submitting.current) return;
    submitting.current = true; setBusy(true);
    try { await send(request); } finally { submitting.current = false; setBusy(false); }
  };
  const clearHistory = () => {
    commit((current) => current.filter(isActive));
    setSelectedId(entriesRef.current[0]?.generationId ?? null);
  };
  const reconnect = async () => {
    try { setSession(await getStudioSession()); setError(""); }
    catch { setError("连接工作台失败，请检查网络后重连。"); }
  };
  return { connection, updateConnection, entries, selectedId, setSelectedId, ready, session, busy, generate, retry, retryIds, clearHistory, error, setError, notice, setNotice, streamOffline, reconnect };
}
