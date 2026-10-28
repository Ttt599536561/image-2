import { useState } from "react";
import { Clock3, Image, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import type { StudioHistoryEntry } from "../../lib/studio/history";
import { useBlobUrl } from "./ReferenceImage";
import { STATUS_LABELS } from "./ResultCanvas";
import styles from "./Studio.module.css";

function HistoryCard({ entry, onSelect }: { entry: StudioHistoryEntry; onSelect: () => void }) {
  const localUrl = useBlobUrl(entry.blob);
  const src = localUrl ?? entry.image?.url;
  return <button type="button" className={styles.historyCard} onClick={onSelect}>
    <div className={styles.historyImage}>{src ? <img src={src} alt={entry.params.prompt} loading="lazy" /> : <><Image size={27} strokeWidth={1.2} /><span>{STATUS_LABELS[entry.status]}</span></>}</div>
    <div className={styles.historyCaption}><p>{entry.params.prompt}</p><span>{new Date(entry.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}<small>{STATUS_LABELS[entry.status]}</small></span></div>
  </button>;
}
export function HistoryView({ entries, onSelect, onClear }: { entries: StudioHistoryEntry[]; onSelect: (id: string) => void; onClear: () => void }) {
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState(false);
  const filtered = entries.filter((entry) => entry.params.prompt.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className={styles.historyView} aria-label="此设备历史">
    <div className={styles.historyHeading}><div><span className={styles.eyebrow}>SAVED ON THIS DEVICE</span><h2>此设备历史 <span>{entries.length}</span></h2><p>你的每次创作，都留在这个浏览器里。</p></div><button type="button" className={styles.secondaryButton} disabled={!entries.length} onClick={() => setConfirm(true)}><Trash2 size={15} />清空历史</button></div>
    <label className={styles.historySearch}><Search size={17} /><input type="search" aria-label="搜索历史提示词" placeholder="搜索画面描述…" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{filtered.length} 个作品</span></label>
    {filtered.length ? <div className={styles.historyGrid}>{filtered.map((entry) => <HistoryCard key={entry.generationId} entry={entry} onSelect={() => onSelect(entry.generationId)} />)}</div> : <div className={styles.historyEmpty}><Clock3 size={32} strokeWidth={1.2} /><h3>{query ? "没有找到相关作品" : "这里等待你的第一张作品"}</h3><p>{query ? "换一个关键词试试。" : "完成的图片会自动保存在此浏览器，不同设备之间不互通。"}</p></div>}
    <p className={styles.localFootnote}>最多保留 50 条 / 200 MiB，超出后移除最早的已完成记录。</p>
    <ConfirmDialog open={confirm} title="清空此设备历史？" message="将删除此浏览器保存的图片与已完成记录，无法恢复。正在生成的任务会保留，API Key 不受影响。" confirmLabel="确认清空" danger onCancel={() => setConfirm(false)} onConfirm={() => { onClear(); setConfirm(false); }} />
  </section>;
}
