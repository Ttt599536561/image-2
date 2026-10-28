import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { MAX_STUDIO_REFERENCE_IMAGES } from "../../contracts/studio";
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
function ReferenceThumbnail({ file, index, onRemove }: { file: File; index: number; onRemove: () => void }) {
  const url = useBlobUrl(file);
  return <div className={styles.referenceThumbnail}>
    {url && <img src={url} alt={`参考图片 ${index + 1}`} />}
    <span className={styles.referenceNumber}>{index + 1}</span>
    <button type="button" aria-label={`移除参考图片 ${index + 1}`} onClick={onRemove}><X size={13} /></button>
    <span className={styles.referenceFilename} title={file.name}>{file.name}</span>
  </div>;
}
export function ReferenceImage({ files, onAdd, onRemove }: { files: File[]; onAdd: (files: File[]) => void; onRemove: (index: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className={`${styles.referenceSection} ${dragging ? styles.referenceDragging : ""}`}
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); onAdd([...event.dataTransfer.files]); }}>
    <div className={styles.fieldHeading}><span>参考图片 <span className={styles.optional}>可选</span></span><span className={styles.referenceCount}>{files.length} / {MAX_STUDIO_REFERENCE_IMAGES}</span></div>
    <input ref={input} type="file" multiple tabIndex={-1} accept="image/png,image/jpeg,image/webp" aria-label="上传参考图片" className={styles.hiddenInput} onChange={(event) => { onAdd([...event.target.files ?? []]); event.target.value = ""; }} />
    {files.length ? <div className={styles.referenceGrid}>
      {files.map((file, index) => <ReferenceThumbnail key={`${file.name}-${file.lastModified}-${index}`} file={file} index={index} onRemove={() => onRemove(index)} />)}
      {Array.from({ length: MAX_STUDIO_REFERENCE_IMAGES - files.length }, (_, index) => <button key={`add-${index}`} type="button" className={styles.referenceAdd} aria-label={`添加参考图片 ${files.length + index + 1}`} onClick={() => input.current?.click()}><Plus size={19} /><span>添加图片</span></button>)}
    </div> : <button type="button" className={styles.dropzone} onClick={() => input.current?.click()}>
      <ImagePlus size={22} strokeWidth={1.5} /><span>点击上传，或拖入图片<small>PNG / JPG / WebP · 每张最大 4 MiB · 支持粘贴</small></span><Plus size={16} />
    </button>}
  </div>;
}
