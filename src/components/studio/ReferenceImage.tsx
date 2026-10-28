import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import styles from "./Studio.module.css";

export function useBlobUrl(blob?: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const value = URL.createObjectURL(blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}
export function ReferenceImage({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const url = useBlobUrl(file);
  const [dragging, setDragging] = useState(false);
  return <div className={styles.referenceSection}>
    <div className={styles.fieldHeading}><span>参考图片</span><span className={styles.optional}>可选</span></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传参考图片" className={styles.hiddenInput} onChange={(event) => { onChange(event.target.files?.[0] ?? null); event.target.value = ""; }} />
    {file ? <div className={styles.referencePreview}>
      {url && <img src={url} alt="参考图片预览" />}
      <span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MiB · 已选为参考图</small></span>
      <button type="button" className={styles.iconButton} aria-label="移除参考图片" onClick={() => onChange(null)}><X size={16} /></button>
    </div> : <button type="button" className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} onClick={() => input.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); const image = event.dataTransfer.files[0]; if (image) onChange(image); }}>
      <ImagePlus size={21} strokeWidth={1.5} />
      <span>点击上传，或拖入图片<small>PNG / JPG / WebP · 最大 4 MiB · 支持粘贴</small></span>
    </button>}
  </div>;
}
