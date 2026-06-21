import type { CSSProperties, JSX } from "react";
import { Wand2 } from "lucide-react";
import type { InspirationItem } from "../../mocks/types";
import styles from "./InspirationGallery.module.css";

export interface InspirationGalleryProps {
  items: InspirationItem[];
  /** 可选：固定列数；不传则按响应式断点（~4 → 2 → 1）。 */
  columns?: number;
  /** true 时渲染 Composer 欢迎态内嵌的迷你画廊变体（紧凑 4 列方形小图）。 */
  compact?: boolean;
  onUsePrompt: (prompt: string) => void;
}

/**
 * 灵感画廊（封面为主体的瀑布流）。
 *
 * 设计真相源：design-system.html §10「灵感卡（封面为主体 · 瀑布流自适应）」。
 * - 封面 <img> 按原始比例完整展示（不裁切）；CSS columns 实现瀑布流。
 * - 下半部半透明渐变浮层承载标题 + 1 行摘要 + 「用此提示词」按钮。
 * - 品类标签浮左上；hover 时按钮变陶土（--accent）。
 * - 仅按钮触发 onUsePrompt（卡片整体非点击目标）。
 *
 * SSR 安全：纯渲染，无 window/document 访问。
 */
export function InspirationGallery({
  items,
  columns,
  compact = false,
  onUsePrompt,
}: InspirationGalleryProps): JSX.Element {
  // 固定列数时通过内联 CSS 变量驱动 column-count（compact 变体走 grid，不受此影响）。
  const wallStyle =
    !compact && typeof columns === "number" && columns > 0
      ? ({ "--insp-cols": String(columns) } as CSSProperties)
      : undefined;

  const wallClass = compact ? styles.wallCompact : styles.wall;

  return (
    <div
      className={`${wallClass}${columns ? ` ${styles.wallFixed}` : ""}`}
      style={wallStyle}
    >
      {items.map((item) => (
        <article key={item.id} className={styles.card}>
          <div
            className={styles.cover}
            style={
              compact
                ? undefined
                : ({
                    aspectRatio: `${item.width} / ${item.height}`,
                  } as CSSProperties)
            }
          >
            <img
              className={styles.coverImg}
              src={item.cover}
              alt={item.title}
              width={item.width}
              height={item.height}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </div>

          <span className={styles.chip}>{item.category}</span>

          <div className={styles.scrim}>
            <p className={styles.title}>{item.title}</p>
            <p className={styles.summary}>{item.summary}</p>
            <button
              type="button"
              className={styles.use}
              onClick={() => onUsePrompt(item.prompt)}
            >
              <Wand2 className={styles.useIcon} aria-hidden="true" />
              用此提示词
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
