import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Circle, Clock3, Link2, Moon, PanelLeftClose, Sparkles, Sun, X } from "lucide-react";
import { STUDIO_MODEL, MAX_STUDIO_REFERENCE_IMAGES, type StudioParams } from "../../contracts/studio";
import { fetchResultBlob, validateReferenceImage } from "../../lib/studio/api";
import { isActive, pickParams, type StudioHistoryEntry } from "../../lib/studio/history";
import { appendReferences } from "../../lib/studio/references";
import { useStudio } from "../../lib/studio/useStudio";
import { prepareReferenceCopy } from "../../lib/studio/referenceCopy";
import { useThemeMode } from "../../lib/theme";
import { useToast } from "../Toast/ToastProvider";
import { ComposerPanel } from "./ComposerPanel";
import { ConnectionPanel } from "./ConnectionPanel";
import { HistoryView } from "./HistoryView";
import { ResultCanvas } from "./ResultCanvas";
import styles from "./Studio.module.css";

type View = "create" | "history" | "settings";
function connectionHost(baseUrl: string): string { try { return new URL(baseUrl).host; } catch { return "填写 API Key"; } }
export function StudioPage() {
  const studio = useStudio();
  const theme = useThemeMode();
  const toast = useToast();
  const [view, setView] = useState<View>("create");
  const [panelOpen, setPanelOpen] = useState(true);
  const [params, setParams] = useState<StudioParams>({ prompt: "", size: "auto", quality: "auto", background: "auto", model: STUDIO_MODEL });
  const [references, setReferences] = useState<File[]>([]);
  const referencesRef = useRef(references);
  const [preparingReference, setPreparingReference] = useState(false);
  const referencePreparation = useRef<AbortController | null>(null);
  useEffect(() => () => { referencePreparation.current?.abort(); }, []);
  const hasConnection = !!studio.connection.apiKey.trim() && !!studio.connection.baseUrl.trim();
  const selected = studio.entries.find((entry) => entry.generationId === studio.selectedId) ?? studio.entries[0];
  const activeCount = studio.entries.filter(isActive).length;
  const navigate = (next: View) => {
    setView(next);
    if (next !== "history") setPanelOpen(true);
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => {
        if (next === "history") window.scrollTo({ top: 0, behavior: "smooth" });
        else document.getElementById("studio-creation-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };
  const updateReferences = (files: File[]) => { referencesRef.current = files; setReferences(files); };
  const chooseReferences = (files: File[]): boolean => {
    const result = appendReferences(referencesRef.current, files);
    if (result.error) { toast.error(result.error); return false; }
    updateReferences(result.files); return true;
  };
  const reuse = (entry: StudioHistoryEntry) => { setParams(pickParams(entry.params)); navigate("create"); toast.info("参数已填入创作面板"); };
  const edit = async (entry: StudioHistoryEntry) => {
    if (referencePreparation.current) return;
    if (referencesRef.current.length >= MAX_STUDIO_REFERENCE_IMAGES) { toast.error("参考图片最多 4 张，请先移除一张再添加。"); return; }
    const controller = new AbortController();
    referencePreparation.current = controller;
    setPreparingReference(true);
    try {
      const blob = entry.blob ?? (entry.image ? await fetchResultBlob(entry.image.url) : null);
      if (controller.signal.aborted) return;
      if (!blob) throw new Error("原图暂时不可用");
      const { file, converted } = await prepareReferenceCopy(blob, entry.generationId, controller.signal);
      if (controller.signal.aborted) return;
      const invalid = validateReferenceImage(file); if (invalid) throw new Error(invalid);
      if (!chooseReferences([file])) return;
      setParams(pickParams(entry.params)); navigate("create");
      toast.info(converted ? "已将大图转换为参考副本，原图不变" : "已将原图设为参考图，可修改描述后生成");
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(cause instanceof Error ? cause.message : "准备参考图片失败，原图不受影响。");
    } finally {
      if (referencePreparation.current === controller) referencePreparation.current = null;
      if (!controller.signal.aborted) setPreparingReference(false);
    }
  };
  const generate = async () => {
    const submittedReferences = referencesRef.current;
    const accepted = await studio.generate(params, submittedReferences);
    setView("create");
    if (accepted) {
      if (referencesRef.current === submittedReferences) updateReferences([]);
      setPanelOpen(false); toast.success("任务已提交");
      if (window.matchMedia("(max-width: 900px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  return <main className={styles.studio}>
    <nav className={styles.rail} aria-label="工作台导航">
      <a href="/" className={styles.brand} aria-label="图像工坊首页"><span><Sparkles size={22} strokeWidth={1.6} /></span><strong>图像工坊</strong></a>
      <div className={styles.navItems}>{([{ id: "create", label: "创作", icon: Sparkles }, { id: "history", label: "此设备历史", icon: Clock3 }, { id: "settings", label: "连接设置", icon: Link2 }] as const).map((item) => <button type="button" key={item.id} aria-current={view === item.id ? "page" : undefined} className={`${styles.navItem} ${view === item.id ? styles.navActive : ""}`} onClick={() => navigate(item.id)}><item.icon size={21} strokeWidth={1.6} /><span>{item.label}</span></button>)}</div>
      <button type="button" className={`${styles.navItem} ${styles.themeButton}`} onClick={theme.toggle} aria-label={theme.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>{theme.theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}<span>{theme.theme === "dark" ? "浅色" : "深色"}</span></button>
    </nav>
    <button type="button" className={styles.mobilePanelToggle} aria-expanded={panelOpen} aria-controls="studio-creation-panel" onClick={() => setPanelOpen(!panelOpen)}><span><Sparkles size={16} />{view === "settings" ? "连接设置" : "创作面板"}</span>{panelOpen ? <PanelLeftClose size={17} /> : <ChevronDown size={17} />}</button>
    <aside id="studio-creation-panel" className={`${styles.sidePanel} ${panelOpen ? styles.panelOpen : ""}`}>
      {view === "settings" ? <ConnectionPanel connection={studio.connection} onChange={studio.updateConnection} onBack={() => navigate("create")} /> : <ComposerPanel params={params} onParams={setParams} references={references} onReferences={chooseReferences} onRemoveReference={(index) => updateReferences(referencesRef.current.filter((_, current) => current !== index))} onGenerate={() => void generate()} busy={studio.busy} enabled={studio.ready && !!studio.session} hasConnection={hasConnection} connectionLabel={connectionHost(studio.connection.baseUrl)} onConnection={() => navigate("settings")} />}
    </aside>
    <div className={`${styles.workspace} ${!selected && view !== "history" ? styles.workspaceEmpty : ""}`}>
      <header className={styles.workspaceHeader}><div><span className={styles.workspaceName}>创作工作台</span><span className={styles.headerSlash}>/</span><span>{view === "history" ? "此设备历史" : "自由创作"}</span></div><div className={styles.workspaceMeta}>{activeCount > 0 && <span className={styles.activeCount}><Circle size={6} fill="currentColor" />{activeCount} 个任务进行中</span>}<button type="button" onClick={() => navigate("settings")}><span className={hasConnection ? styles.connectionDot : styles.offlineDot} />{hasConnection ? "Key 已配置" : "尚未连接"}<ArrowUpRight size={13} /></button></div></header>
      {studio.error && <div className={styles.errorBanner} role="alert"><span>{studio.error}</span>{!studio.session && <button type="button" onClick={() => void studio.reconnect()}>重新连接</button>}<button type="button" aria-label="关闭错误提示" onClick={() => studio.setError("")}><X size={15} /></button></div>}
      {studio.notice && <div className={styles.noticeBanner} role="status"><span>{studio.notice}</span><button type="button" aria-label="关闭存储提示" onClick={() => studio.setNotice("")}><X size={15} /></button></div>}
      {studio.streamOffline && activeCount > 0 && <div className={styles.connectionNotice} role="status">实时连接暂时中断，正在定期检查任务状态。</div>}
      {view === "history" ? <HistoryView entries={studio.entries} onSelect={(id) => { studio.setSelectedId(id); setView("create"); setPanelOpen(false); }} onClear={studio.clearHistory} /> : <ResultCanvas entry={selected} entries={studio.entries} onSelect={studio.setSelectedId} onReuse={reuse} onEdit={(entry) => void edit(entry)} preparingReference={preparingReference} onConnect={() => navigate("settings")} hasConnection={hasConnection} retryable={!!selected && studio.retryIds.includes(selected.generationId)} onRetry={() => { if (selected) void studio.retry(selected.generationId); }} busy={studio.busy} />}
    </div>
  </main>;
}
