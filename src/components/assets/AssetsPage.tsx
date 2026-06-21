import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, Download, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DeleteResponse, type ImageItem, type ImageRange, type ImagesResponse } from "../../contracts/image";
import { useAssets } from "../../hooks/queries";
import { apiDelete } from "../../lib/api-client";
import { downloadImage, imageFilename } from "../../lib/download";
import { dateGroupLabel } from "../../lib/format";
import { downloadImagesAsZip, exportZipName } from "../../lib/zip";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Assets.module.css";

const RANGES: { value: ImageRange; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
];

export function AssetsPage({ initialImages }: { initialImages?: ImagesResponse }) {
  const lightbox = useLightbox();
  const shell = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState<ImageRange>("all");
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const lastClicked = useRef<string | null>(null);

  // range="all" 用 loader initialData；切换其它档走客户端 fetch。
  const assets = useAssets({ range }, range === "all" ? initialImages : undefined);
  const items = assets.data?.items ?? [];
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  const groups = useMemo(() => {
    const map = new Map<string, ImageItem[]>();
    for (const it of items) {
      const key = dateGroupLabel(it.createdAt);
      const arr = map.get(key);
      if (arr) arr.push(it);
      else map.set(key, [it]);
    }
    return [...map.entries()];
  }, [items]);

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiDelete("/api/images", { ids }, DeleteResponse),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      setSelected(new Set());
      setConfirmOpen(false);
      lastClicked.current = null;
      toast.success(`已删除 ${res.deleted} 张`);
    },
    onError: () => {
      setConfirmOpen(false);
      toast.error("删除失败，请重试");
    },
  });

  const exitBulk = () => {
    setBulk(false);
    setSelected(new Set());
    lastClicked.current = null;
  };

  const onThumbClick = (item: ImageItem, e: React.MouseEvent) => {
    if (!bulk) {
      lightbox.open(item.publicUrl, imageFilename(item.publicUrl, item.id));
      return;
    }
    const shift = e.shiftKey; // 在 setState 更新器外读取（避免合成事件复用风险）
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked.current) {
        // Shift 连选：选中上次点击与本次之间的区间（按显示顺序）。
        const a = orderedIds.indexOf(lastClicked.current);
        const b = orderedIds.indexOf(item.id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
        }
      } else if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
    lastClicked.current = item.id;
  };

  const selectedItems = () => items.filter((i) => selected.has(i.id));

  const onZip = async () => {
    const list = selectedItems();
    if (list.length === 0 || zipping) return;
    setZipping(true);
    try {
      await downloadImagesAsZip(
        list.map((i) => ({ url: i.publicUrl, name: imageFilename(i.publicUrl, i.id) })),
        exportZipName(),
      );
    } catch {
      // CORS/网络失败 → 退化为逐张单下（08 §9.6「亦可退化为逐张单下」）。
      toast.info("打包受限，已改为逐张下载");
      for (const i of list) downloadImage(i.publicUrl, imageFilename(i.publicUrl, i.id));
    } finally {
      setZipping(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <>
      <TopBar title="资产库" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.headRow}>
            <div className={styles.head}>
              <h1 className={styles.title}>资产库</h1>
              <p className={styles.sub}>
                {bulk ? "点选图片，框选下方操作 · 仅本人生成" : "点任意图放大预览 · 仅本人生成、不支持上传"}
              </p>
            </div>
            <button
              type="button"
              className={`${styles.manageBtn} ${bulk ? styles.manageBtnActive : ""}`}
              onClick={() => (bulk ? exitBulk() : setBulk(true))}
            >
              <CheckSquare size={14} />
              {bulk ? "完成" : "批量管理"}
            </button>
          </div>

          <div className={styles.filterBar}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`${styles.chip} ${range === r.value ? styles.chipActive : ""}`}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <div className={styles.empty}>该时间段内还没有图片</div>
          ) : (
            groups.map(([label, groupItems]) => (
              <div className={styles.group} key={label}>
                <div className={styles.groupHead}>{label}</div>
                <div className={styles.grid}>
                  {groupItems.map((it) => {
                    const isSel = selected.has(it.id);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        className={`${styles.thumb} ${bulk ? styles.thumbSelectable : ""} ${
                          isSel ? styles.thumbSelected : ""
                        }`}
                        onClick={(e) => onThumbClick(it, e)}
                        aria-pressed={bulk ? isSel : undefined}
                      >
                        {bulk ? (
                          <span className={`${styles.check} ${isSel ? styles.checkOn : ""}`}>
                            <Check size={13} />
                          </span>
                        ) : null}
                        <img src={it.publicUrl} alt={it.prompt} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {bulk && selectedCount > 0 ? (
            <div className={styles.actionBar}>
              <span className={styles.actionCount}>已选 {selectedCount} 张</span>
              <button type="button" className={styles.actionBtn} onClick={onZip} disabled={zipping}>
                <Download size={14} />
                打包下载
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionDanger}`}
                onClick={() => setConfirmOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 size={14} />
                删除
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`删除 ${selectedCount} 张图片?`}
        message="删除后不可恢复，对应文件也会一并清除。"
        confirmLabel="删除"
        danger
        busy={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate([...selected])}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
