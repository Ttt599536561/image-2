import { useMemo, useState } from "react";
import { dateGroupLabel } from "../../lib/format";
import { useMock } from "../../mocks/store";
import type { Turn } from "../../mocks/types";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import styles from "./Assets.module.css";

type Range = "all" | "today" | "7d" | "30d";
const RANGES: { value: Range; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
];
const DAY = 24 * 60 * 60 * 1000;

export function AssetsPage() {
  const mock = useMock();
  const lightbox = useLightbox();
  const shell = useShell();
  const [range, setRange] = useState<Range>("all");

  const images = useMemo(() => {
    const all: Turn[] = mock.conversations.flatMap((c) =>
      c.turns.filter((t) => t.status === "succeeded" && t.image),
    );
    const now = Date.now();
    const cutoff = range === "today" ? 0 : range === "7d" ? 7 * DAY : range === "30d" ? 30 * DAY : null;
    const filtered =
      range === "all"
        ? all
        : all.filter((t) => {
            const ts = Date.parse(t.createdAt);
            if (range === "today") return new Date(ts).toDateString() === new Date(now).toDateString();
            return now - ts <= (cutoff as number);
          });
    return filtered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [mock.conversations, range]);

  const groups = useMemo(() => {
    const map = new Map<string, Turn[]>();
    for (const t of images) {
      const key = dateGroupLabel(t.createdAt);
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()];
  }, [images]);

  return (
    <>
      <TopBar title="资产库" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.head}>
            <h1 className={styles.title}>资产库</h1>
            <p className={styles.sub}>点任意图放大预览 · 仅本人生成、不支持上传</p>
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
            groups.map(([label, items]) => (
              <div className={styles.group} key={label}>
                <div className={styles.groupHead}>{label}</div>
                <div className={styles.grid}>
                  {items.map((t) =>
                    t.image ? (
                      <button
                        key={t.id}
                        type="button"
                        className={styles.thumb}
                        onClick={() => lightbox.open(t.image!.publicUrl, `图像工坊_${t.id}.svg`)}
                      >
                        <img src={t.image.publicUrl} alt={t.prompt} />
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
