import type { CSSProperties, JSX } from "react";
import { Wand2 } from "lucide-react";
import type { InspirationItem } from "../../contracts/inspiration";
import { imageFilename } from "../../lib/download";
import { useLightbox } from "../Lightbox/LightboxProvider";
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
 * - #1：点卡片（除「用此提示词」按钮外）放大进 lightbox，放大后标题/摘要仍悬浮图上（高级视觉）。
 *
 * SSR 安全：纯渲染，lightbox.open 只在点击时调用。
 */
export function InspirationGallery({
  items,
  columns,
  compact = false,
  onUsePrompt,
}: InspirationGalleryProps): JSX.Element {
  const lightbox = useLightbox();

  // 固定列数时通过内联 CSS 变量驱动 column-count（compact 变体走 grid，不受此影响）。
  const wallStyle =
    !compact && typeof columns === "number" && columns > 0
      ? ({ "--insp-cols": String(columns) } as CSSProperties)
      : undefined;

  const wallClass = compact ? styles.wallCompact : styles.wall;

  // #1：放大进 lightbox，传入悬浮说明层（标题/摘要/用此提示词）。
  const enlarge = (item: InspirationItem) => {
    const caption = (
      <div className={styles.lbCaption}>
        {item.category ? <span className={styles.lbChip}>{item.category}</span> : null}
        <p className={styles.lbTitle}>{item.title}</p>
        {item.summary ? <p className={styles.lbSummary}>{item.summary}</p> : null}
        {item.submitter ? <p className={styles.lbSummary}>由 {item.submitter} 投稿</p> : null}
        <button
          type="button"
          className={styles.lbUse}
          onClick={() => {
            lightbox.close();
            onUsePrompt(item.prompt);
          }}
        >
          <Wand2 className={styles.useIcon} aria-hidden="true" />
          用此提示词
        </button>
      </div>
    );
    lightbox.open(item.cover, imageFilename(item.cover, item.id), {
      caption,
      showActions: false,
    });
  };

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
              compact || item.width == null || item.height == null
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
              width={item.width ?? undefined}
              height={item.height ?? undefined}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
            {/* #1：点图放大（键盘可达；覆盖封面非渐变区域） */}
            <button
              type="button"
              className={styles.enlarge}
              aria-label={`放大查看：${item.title}`}
              onClick={() => enlarge(item)}
            />
          </div>

          {item.category ? <span className={styles.chip}>{item.category}</span> : null}

          {/* 渐变浮层；点击空白处也放大（鼠标增强），「用此提示词」阻止冒泡 */}
          <div className={styles.scrim} onClick={() => enlarge(item)}>
            <p className={styles.title}>{item.title}</p>
            <p className={styles.summary}>{item.summary}</p>
            {item.submitter ? <p className={styles.byline}>由 {item.submitter} 投稿</p> : null}
            <button
              type="button"
              className={styles.use}
              onClick={(e) => {
                e.stopPropagation();
                onUsePrompt(item.prompt);
              }}
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
