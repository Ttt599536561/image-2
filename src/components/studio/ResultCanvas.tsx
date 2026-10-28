import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, Clock3, Expand, ImagePlus, Images, LoaderCircle, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { downloadImage } from "../../lib/download";
import { isActive, type StudioHistoryEntry } from "../../lib/studio/history";
import { useBlobUrl } from "./ReferenceImage";
import styles from "./Studio.module.css";

export const STATUS_LABELS = { queued: "排队中", claimed: "准备生成", running: "生成中", succeeded: "已完成", failed: "生成失败" };
export function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}
function Elapsed({ entry }: { entry: StudioHistoryEntry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!isActive(entry)) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [entry.status]);
  const elapsed = entry.durationMs ?? (isActive(entry) ? now - entry.createdAt : entry.elapsedMs ?? 0);
  return <span>{durationLabel(elapsed)}</span>;
}
export function JobThumbnail({ entry, selected, onSelect }: { entry: StudioHistoryEntry; selected?: boolean; onSelect: () => void }) {
  const localUrl = useBlobUrl(entry.blob);
  const src = localUrl ?? entry.image?.url;
  return <button type="button" className={`${styles.jobThumb} ${selected ? styles.jobThumbSelected : ""}`} onClick={onSelect} aria-label={`${STATUS_LABELS[entry.status]}：${entry.params.prompt}`} aria-pressed={selected}>
    {src ? <img src={src} alt="" loading="lazy" /> : entry.status === "failed" ? <TriangleAlert size={19} /> : <LoaderCircle size={19} className={styles.spinner} />}
  </button>;
}
type Props = { entry?: StudioHistoryEntry; entries: StudioHistoryEntry[]; onSelect: (id: string) => void; onReuse: (entry: StudioHistoryEntry) => void; onEdit: (entry: StudioHistoryEntry) => void; preparingReference: boolean; onConnect: () => void; hasConnection: boolean; retryable: boolean; onRetry: () => void; busy: boolean };
export function ResultCanvas({ entry, entries, onSelect, onReuse, onEdit, preparingReference, onConnect, hasConnection, retryable, onRetry, busy }: Props) {
  const lightbox = useLightbox();
  const localUrl = useBlobUrl(entry?.blob);
  const src = localUrl ?? entry?.image?.url;
  const filename = `图像工坊_${entry?.generationId ?? "image"}.${entry?.blob?.type === "image/webp" ? "webp" : entry?.blob?.type === "image/jpeg" ? "jpg" : "png"}`;
  return <section className={styles.canvasSection} aria-label="生成结果">
    <div className={styles.canvasToolbar}><div className={styles.canvasTitle}><Images size={17} strokeWidth={1.5} /><span>{entry ? "创作预览" : "你的创作画布"}</span>{entry && <span className={`${styles.statusPill} ${entry.status === "succeeded" ? styles.successPill : ""}`}><i />{STATUS_LABELS[entry.status]}</span>}</div><span className={styles.modelBadge}>{entry?.params.model === "gpt-image-2.5-sunburst" ? "IMAGE 2.5 SUNBURST" : "GPT IMAGE 2"}</span></div>
    <div className={`${styles.canvas} ${!entry ? styles.canvasEmpty : ""} ${entry?.status === "succeeded" ? styles.canvasWithImage : ""}`}>
      {!entry ? <div className={styles.emptyCanvas}><div className={styles.emptyArt} aria-hidden><span /><span /><div><Sparkles size={34} strokeWidth={1.15} /></div></div><span className={styles.eyebrow}>A LITTLE IDEA. A NEW IMAGE.</span><h2>从一个想法开始</h2><p>写下画面，选择比例。<br />让此刻的灵感，成为看得见的作品。</p>{!hasConnection ? <button type="button" className={styles.textAction} onClick={onConnect}>连接图片服务<ArrowUpRight size={15} /></button> : <span className={styles.emptyHint}>在创作面板输入描述，开始生成</span>}<div className={styles.canvasCorner}>YOUR SPACE TO CREATE</div></div>
      : entry.status === "succeeded" && src ? <button type="button" className={styles.imageStage} aria-label="放大查看生成图片" onClick={() => lightbox.open(src, filename)}><img src={src} alt={entry.params.prompt} /><span><Expand size={15} />放大查看</span></button>
      : entry.status === "failed" ? <div className={styles.taskState}><div className={styles.failureIcon}><TriangleAlert size={26} strokeWidth={1.5} /></div><h2>这次生成未能完成</h2><p>{entry.error?.message ?? "请检查服务连接或调整描述后重试。"}</p><button type="button" className={styles.secondaryButton} onClick={() => onReuse(entry)}><RotateCcw size={15} />调整参数</button></div>
      : <div className={styles.taskState}><div className={styles.generationOrbit}><Sparkles size={31} strokeWidth={1.3} /><span /></div><span className={styles.eyebrow}>{retryable ? "AWAITING CONFIRMATION" : "CREATION IN PROGRESS"}</span><h2>{retryable ? "等待确认任务状态" : entry.status === "queued" ? "灵感已就位，等待生成" : "正在描绘你的想法"}</h2><p>{retryable ? "网络中断时，先确认原任务，避免重复提交。" : "可以继续创建下一张，作品完成后会留在这里。"}</p><div className={styles.elapsed}><Clock3 size={15} /><Elapsed entry={entry} /><span>·</span>{STATUS_LABELS[entry.status]}</div>{retryable && <button type="button" className={styles.secondaryButton} onClick={onRetry} disabled={busy}>确认并重试</button>}</div>}
    </div>
    {entry && <div className={styles.resultFooter}><div className={styles.resultCaption}><p title={entry.params.prompt}>{entry.params.prompt}</p><div><span>{entry.image?.width && entry.image.height ? `${entry.image.width} × ${entry.image.height}` : entry.params.size === "auto" ? "自动比例" : entry.params.size.replace("x", " × ")}</span><span>·</span><Elapsed entry={entry} />{entry.blob && <><span>·</span><span className={styles.savedLabel}><Check size={12} />原图已就绪</span></>}</div></div><div className={styles.resultActions}><button type="button" onClick={() => onReuse(entry)}><RotateCcw size={15} /><span>复用参数</span></button>{entry.status === "succeeded" && src && <><button type="button" disabled={preparingReference} aria-busy={preparingReference} onClick={() => onEdit(entry)}>{preparingReference ? <LoaderCircle size={15} className={styles.spinner} /> : <ImagePlus size={15} />}<span>{preparingReference ? "准备中…" : "以图编辑"}</span></button><button type="button" onClick={() => lightbox.open(src, filename)} aria-label="放大查看"><Expand size={15} /></button><button type="button" className={styles.downloadButton} onClick={() => void downloadImage(src, filename)}><ArrowDownToLine size={15} /><span>下载原图</span></button></>}</div></div>}
    {entries.length > 0 && <div className={styles.recentStrip}><span>最近创作<small>{entries.length}</small></span><div>{entries.slice(0, 12).map((item) => <JobThumbnail key={item.generationId} entry={item} selected={item.generationId === entry?.generationId} onSelect={() => onSelect(item.generationId)} />)}</div></div>}
    <p className={styles.localFootnote}>历史保存在当前浏览器，最多 50 条 / 200 MiB。重要作品请下载留存。</p>
  </section>;
}
