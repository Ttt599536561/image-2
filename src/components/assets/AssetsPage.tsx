import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, Download, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DeleteResponse, type ImageItem, type ImageRange, type ImagesResponse } from "../../contracts/image";
import { dayStr, expiringInDays, rectsIntersect } from "../../lib/assetsSelection";
import { useAssets, useMe } from "../../hooks/queries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiDelete } from "../../lib/api-client";
import { downloadImage, imageFilename } from "../../lib/download";
import { dateGroupLabel } from "../../lib/format";
import { downloadImagesAsZip, exportZipName } from "../../lib/zip";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { DateRangePicker } from "./DateRangePicker";
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
  { value: "custom", label: "自定义" },
];

const LONG_PRESS_MS = 450;
const DRAG_THRESHOLD = 5;

export function AssetsPage({ initialImages }: { initialImages?: ImagesResponse }) {
  const lightbox = useLightbox();
  const shell = useShell();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const [range, setRange] = useState<ImageRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 250); // P3-S2 按提示词搜索防抖
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastClicked = useRef<string | null>(null);
  const suppressClick = useRef(false); // drag/long-press 结束后吞掉随之而来的 click
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);

  const isCustom = range === "custom";
  const customReady = isCustom && !!customFrom;
  const minDate = me.data?.user.createdAt ? me.data.user.createdAt.slice(0, 10) : undefined;
  const maxDate = dayStr(new Date());
  const fromISO = customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : undefined;
  const toISO = customTo ? new Date(`${customTo}T23:59:59.999`).toISOString() : undefined;

  const baseQuery = isCustom ? { range: "custom" as const, from: fromISO, to: toISO } : { range };
  const query = search ? { ...baseQuery, q: search } : baseQuery;
  // range="all" 且无搜索词 → 用 loader initialData；自定义未选起始日则不发请求（enabled=false）。
  const assets = useAssets(query, range === "all" && !search ? initialImages : undefined, !isCustom || customReady);
  const items = useMemo(() => assets.data?.items ?? [], [assets.data]);
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

  const clearCustom = () => {
    setCustomFrom("");
    setCustomTo("");
  };

  const onThumbClick = (item: ImageItem, e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false; // 这次 click 来自 drag/长按，吞掉
      return;
    }
    if (!bulk) {
      lightbox.open(item.publicUrl, imageFilename(item.publicUrl, item.id));
      return;
    }
    const shift = e.shiftKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked.current) {
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

  // —— 桌面：bulk 模式下网格区域拖拽框选（仅鼠标）——
  const onAreaPointerDown = (e: React.PointerEvent) => {
    suppressClick.current = false;
    if (!bulk || e.pointerType !== "mouse" || e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = new Set(selected); // 本次框选叠加在已选之上
    let moved = false;

    const apply = (l: number, t: number, r: number, b: number) => {
      const next = new Set(base);
      const nodes = gridAreaRef.current?.querySelectorAll<HTMLElement>("[data-thumb-id]") ?? [];
      for (const node of nodes) {
        if (rectsIntersect(node.getBoundingClientRect(), { left: l, top: t, right: r, bottom: b })) {
          const id = node.dataset.thumbId;
          if (id) next.add(id);
        }
      }
      setSelected(next);
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      const x = Math.min(startX, ev.clientX);
      const y = Math.min(startY, ev.clientY);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      setDragRect({ x, y, w, h });
      apply(x, y, x + w, y + h);
      ev.preventDefault();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragRect(null);
      if (moved) suppressClick.current = true; // 吞掉 pointerup 后的 click
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // —— 移动端：缩略图长按进入多选 ——
  const onThumbPointerDown = (item: ImageItem, e: React.PointerEvent) => {
    suppressClick.current = false;
    if (e.pointerType !== "touch") return;
    const x = e.clientX;
    const y = e.clientY;
    const timer = setTimeout(() => {
      if (!bulk) setBulk(true);
      setSelected((prev) => new Set(prev).add(item.id));
      lastClicked.current = item.id;
      suppressClick.current = true; // 吞掉松手后的 click
      longPress.current = null;
    }, LONG_PRESS_MS);
    longPress.current = { timer, x, y };
  };
  const onThumbPointerMove = (e: React.PointerEvent) => {
    const lp = longPress.current;
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) {
      clearTimeout(lp.timer);
      longPress.current = null;
    }
  };
  const onThumbPointerEnd = () => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
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
                {bulk ? "点选 / 拖拽框选图片，下方批量操作 · 仅本人生成" : "点任意图放大预览 · 长按可多选 · 仅本人生成"}
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
            <div className={styles.searchWrap}>
              <Search size={14} />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="搜索提示词"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="按提示词搜索图片"
              />
            </div>
          </div>

          {isCustom ? (
            <div className={styles.customRow}>
              <DateRangePicker
                from={customFrom}
                to={customTo}
                min={minDate}
                max={maxDate}
                onChange={(f, t) => {
                  setCustomFrom(f);
                  setCustomTo(t);
                }}
                onClear={clearCustom}
              />
            </div>
          ) : null}

          {isCustom && !customReady ? (
            <div className={styles.empty}>选择起始日期以筛选</div>
          ) : groups.length === 0 ? (
            <div className={styles.empty}>{search ? "未找到匹配的图片" : "该时间段内还没有图片"}</div>
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: 框选交互仅鼠标增强，不替代键盘可达的逐张选择
            <div ref={gridAreaRef} className={styles.gridArea} onPointerDown={onAreaPointerDown}>
              {groups.map(([label, groupItems]) => (
                <div className={styles.group} key={label}>
                  <div className={styles.groupHead}>{label}</div>
                  <div className={styles.grid}>
                    {groupItems.map((it) => {
                      const isSel = selected.has(it.id);
                      const expDays = expiringInDays(it.expiresAt);
                      return (
                        <button
                          key={it.id}
                          type="button"
                          data-thumb-id={it.id}
                          className={`${styles.thumb} ${bulk ? styles.thumbSelectable : ""} ${
                            isSel ? styles.thumbSelected : ""
                          }`}
                          onClick={(e) => onThumbClick(it, e)}
                          onPointerDown={(e) => onThumbPointerDown(it, e)}
                          onPointerMove={onThumbPointerMove}
                          onPointerUp={onThumbPointerEnd}
                          onPointerCancel={onThumbPointerEnd}
                          aria-pressed={bulk ? isSel : undefined}
                        >
                          {bulk ? (
                            <span className={`${styles.check} ${isSel ? styles.checkOn : ""}`}>
                              <Check size={13} />
                            </span>
                          ) : null}
                          {expDays !== null ? <span className={styles.expBadge}>{expDays} 天后过期</span> : null}
                          <img src={it.publicUrl} alt={it.prompt} draggable={false} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
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

      {dragRect ? (
        <div
          className={styles.selectionBox}
          style={{ left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h }}
        />
      ) : null}

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
