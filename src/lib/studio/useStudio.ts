import { useCallback, useEffect, useRef, useState } from "react";
import { StudioGenerateRequest, type StudioParams, type StudioSessionInfo, type StudioStatusBatch } from "../../contracts/studio";
import { DEFAULT_CONNECTION, loadConnection, saveConnection, type StudioConnection } from "./connection";
import { fetchResultBlob, getStudioSession, getStudioStatus, StudioApiError, submitGeneration, uploadReference } from "./api";
import { isActive, pickParams, pruneHistory, readHistory, writeHistory, type StudioHistoryEntry } from "./history";
import { appendReferences } from "./references";

const STORAGE_WARNING = "此浏览器未能保存历史。当前结果仍可查看和下载，请及时下载原图。";
const INTERRUPTED_PREPARATION = { code: "preparation_interrupted", message: "任务在送达服务前已中断，请重新选择参考图并提交。" };
type Preparation = { request: StudioGenerateRequest; references: File[]; keys: string[] };
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
  const preparations = useRef(new Map<string, Preparation>());
  const recoveryDeadlines = useRef(new Map<string, number>());
  const [retryIds, setRetryIds] = useState<string[]>([]);
  const downloading = useRef(new Set<string>());
  const saveQueue = useRef(Promise.resolve());
  const mounted = useRef(true);

  const commit = useCallback((update: (current: StudioHistoryEntry[]) => StudioHistoryEntry[]) => {
    const next = pruneHistory(update(entriesRef.current));
    const retained = new Set(next.map((entry) => entry.generationId));
    for (const id of preparations.current.keys()) if (!retained.has(id)) preparations.current.delete(id);
    for (const id of retryRequests.current.keys()) if (!retained.has(id)) retryRequests.current.delete(id);
    for (const id of recoveryDeadlines.current.keys()) if (!retained.has(id)) recoveryDeadlines.current.delete(id);
    setRetryIds((ids) => ids.every((id) => retained.has(id)) ? ids : ids.filter((id) => retained.has(id)));
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
      // Active local markers are checked with the server first: a reload can race acceptance.
      const restored = saved.map((entry) => entry.localPreparation && !isActive(entry) ? { ...entry, localPreparation: undefined, error: INTERRUPTED_PREPARATION } : entry);
      // A POST from the previous page may still be committing after its first status miss.
      for (const entry of restored) if (isActive(entry) && !Number.isFinite(Date.parse(entry.deadlineAt))) recoveryDeadlines.current.set(entry.generationId, Date.now() + 30_000);
      commit(() => restored);
      setSelectedId(saved[0]?.generationId ?? null);
    }).catch(() => { if (mounted.current) setNotice(STORAGE_WARNING); }).finally(() => { if (mounted.current) setReady(true); });
    void getStudioSession().then((info) => { if (mounted.current) setSession(info); }).catch(() => { if (mounted.current) setError("连接工作台失败，请检查网络后重连。"); });
    return () => { mounted.current = false; preparations.current.clear(); retryRequests.current.clear(); recoveryDeadlines.current.clear(); };
  }, [commit]);

  const updateConnection = useCallback((next: StudioConnection) => {
    const fixed = { ...next, baseUrl: DEFAULT_CONNECTION.baseUrl };
    setConnection(fixed);
    try { saveConnection(fixed, window.localStorage); }
    catch { setNotice("连接设置未能保存在此浏览器，当前页面仍可使用。"); }
  }, []);

  const receive = useCallback((batch: StudioStatusBatch) => {
    if (!mounted.current || !Array.isArray(batch.items) || !Array.isArray(batch.missingIds)) return;
    commit((current) => current.map((entry) => {
      if (entry.localPreparation && preparations.current.has(entry.generationId)) return entry;
      const update = batch.items.find((item) => item.generationId === entry.generationId);
      if (update) {
        const temporaryFailure = entry.status === "failed" && retryRequests.current.has(entry.generationId);
        const rank = { queued: 0, claimed: 1, running: 2, succeeded: 3, failed: 3 };
        if (!temporaryFailure && (rank[update.status] < rank[entry.status] || (!isActive(entry) && update.status !== entry.status))) return entry;
        retryRequests.current.delete(entry.generationId);
        recoveryDeadlines.current.delete(entry.generationId);
        return { ...entry, ...update, error: update.error, localPreparation: undefined };
      }
      const recoveryDeadline = recoveryDeadlines.current.get(entry.generationId);
      if (recoveryDeadline !== undefined && batch.missingIds.includes(entry.generationId) && isActive(entry)) {
        if (Date.now() < recoveryDeadline) return entry;
        recoveryDeadlines.current.delete(entry.generationId);
        return { ...entry, localPreparation: undefined, status: "failed", error: INTERRUPTED_PREPARATION };
      }
      // A pre-acceptance poll/SSE snapshot may arrive after the POST confirms this task.
      // Trust the server's confirmed lifetime until its deadline instead of that stale miss.
      if (batch.missingIds.includes(entry.generationId) && !retryRequests.current.has(entry.generationId) && !(Date.parse(entry.deadlineAt) > Date.now()) && Date.now() - entry.createdAt > 30_000 && isActive(entry)) {
        return { ...entry, status: "failed", error: { code: "task_unavailable", message: "此任务已不可查询，可能已过期或浏览器会话已清除。" } };
      }
      return entry;
    }));
    setRetryIds((ids) => ids.filter((id) => retryRequests.current.has(id) || preparations.current.has(id)));
  }, [commit]);

  const activeIds = entries.filter((entry) => (isActive(entry) || (entry.status === "failed" && retryRequests.current.has(entry.generationId))) && (!entry.localPreparation || !preparations.current.has(entry.generationId))).map((entry) => entry.generationId).sort().join(",");
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
        if (stopped) return;
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
      if (!mounted.current) return false;
      retryRequests.current.delete(request.generationId);
      commit((current) => current.map((entry) => entry.generationId === request.generationId ? { ...entry, conversationId: accepted.conversationId, deadlineAt: accepted.deadlineAt } : entry));
      setError("");
      return true;
    } catch (cause) {
      if (!mounted.current) return false;
      // Polling may already have confirmed or completed the task while the POST failed.
      if (!retryRequests.current.has(request.generationId)) return true;
      if (cause instanceof StudioApiError && cause.status < 500) {
        if (cause.status === 429) setRetryIds((ids) => [...new Set([...ids, request.generationId])]);
        else retryRequests.current.delete(request.generationId);
        const message = cause.message;
        commit((current) => current.map((entry) => entry.generationId === request.generationId ? { ...entry, status: "failed", error: { code: "request_rejected", message } } : entry));
        setError(message);
      } else {
        setError("网络中断，尚未确认任务是否受理。可点击“确认并重试”，将使用同一任务 ID，避免重复生成。");
        setRetryIds((ids) => [...new Set([...ids, request.generationId])]);
      }
      return false;
    } finally { if (mounted.current) setRetryIds((ids) => ids.filter((id) => retryRequests.current.has(id) || preparations.current.has(id))); }
  }, [commit]);

  const prepareAndSend = useCallback(async (id: string) => {
    const preparation = preparations.current.get(id);
    if (!preparation) return;
    try {
      // Completed uploads survive a retry; remaining files keep their original order.
      while (preparation.keys.length < preparation.references.length) {
        const key = await uploadReference(preparation.references[preparation.keys.length]);
        if (!mounted.current) return;
        preparation.keys.push(key);
      }
      if (!mounted.current) return;
      const request = { ...preparation.request, ...(preparation.keys.length ? { inputImageKeys: [...preparation.keys] } : {}) };
      retryRequests.current.set(id, request);
      preparations.current.delete(id);
      commit((current) => current.map((entry) => entry.generationId === id ? { ...entry, localPreparation: undefined } : entry));
      await send(request);
    } catch {
      if (!mounted.current) return;
      const error = { code: "preparation_failed", message: "任务暂未完成，请重试此任务。" };
      commit((current) => current.map((entry) => entry.generationId === id ? { ...entry, status: "failed", error } : entry));
      setRetryIds((ids) => [...new Set([...ids, id])]);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [commit, send]);

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
    const request = parsed.data;
    const entry: StudioHistoryEntry = { generationId: request.generationId, params: pickParams(request), createdAt: Date.now(), deadlineAt: "", status: "queued", localPreparation: true };
    preparations.current.set(entry.generationId, { request, references: [...references], keys: [] });
    commit((current) => [entry, ...current]);
    setSelectedId(entry.generationId);
    void prepareAndSend(entry.generationId);
    return true;
  }, [connection, ready, session, commit, prepareAndSend]);

  const retry = async (id: string) => {
    const request = retryRequests.current.get(id);
    const preparation = preparations.current.get(id);
    if ((!request && !preparation) || submitting.current) return;
    submitting.current = true; setBusy(true);
    setError("");
    setRetryIds((ids) => ids.filter((retryId) => retryId !== id));
    if (preparation) {
      commit((current) => current.map((entry) => entry.generationId === id ? { ...entry, status: "queued", error: undefined } : entry));
      await prepareAndSend(id);
    } else {
      commit((current) => current.map((entry) => entry.generationId === id && entry.status === "failed" ? { ...entry, status: "queued", error: undefined } : entry));
      try { await send(request!); } finally { submitting.current = false; if (mounted.current) setBusy(false); }
    }
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
