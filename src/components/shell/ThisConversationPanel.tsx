import { Copy, Download, X } from "lucide-react";
import { useEffect } from "react";
import type { ConversationGeneration } from "../../contracts/conversation";
import { copyImageToClipboard, downloadImage, imageFilename } from "../../lib/download";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { useLightbox } from "../Lightbox/LightboxProvider";
import { useToast } from "../Toast/ToastProvider";
import styles from "./ThisConversationPanel.module.css";

export function ThisConversationPanel({
  turns,
  mode,
  onClose,
}: {
  turns: ConversationGeneration[];
  mode: "column" | "drawer";
  onClose?: () => void;
}) {
  const lightbox = useLightbox();
  const toast = useToast();
  const images = turns.filter((t) => t.status === "succeeded" && t.image).slice().reverse();

  // 抽屉态：锁背景滚动 + ESC 关闭
  useLockBodyScroll(mode === "drawer");
  useEffect(() => {
    if (mode !== "drawer") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  // #19：复制图片 blob 到剪贴板
  const copyImage = (url: string) => {
    copyImageToClipboard(url).then(
      () => toast.success("图片已复制到剪贴板"),
      () => toast.error("复制图片失败，请改用下载"),
    );
  };

  const body = (
    <div className={`${styles.panel} ${mode === "column" ? styles.column : styles.drawer}`}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>本次 · {images.length}</span>
        <div className={styles.headerActions}>
          {images.length > 0 ? (
            <button
              type="button"
              className={styles.downloadAll}
              onClick={() =>
                images.forEach((t) =>
                  t.image ? downloadImage(t.image.publicUrl, imageFilename(t.image.publicUrl, t.id)) : null,
                )
              }
            >
              <Download size={13} />
              下载全部
            </button>
          ) : null}
          {mode === "drawer" ? (
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>

      {images.length === 0 ? (
        <div className={styles.empty}>本次对话还没有成品图</div>
      ) : (
        <div className={styles.grid}>
          {images.map((t) =>
            t.image ? (
              <div className={styles.tile} key={t.id}>
                <div className={styles.thumbWrap}>
                  {/* #18：每张图直接可下载、不必先放大；点图仍可放大 */}
                  <button
                    type="button"
                    className={styles.thumb}
                    onClick={() =>
                      lightbox.open(t.image!.publicUrl, imageFilename(t.image!.publicUrl, t.id))
                    }
                  >
                    <img src={t.image.publicUrl} alt={t.prompt} />
                  </button>
                  {/* #20：右下角悬浮下载 */}
                  <button
                    type="button"
                    className={styles.thumbDownload}
                    title="下载"
                    aria-label="下载图片"
                    onClick={() =>
                      downloadImage(t.image!.publicUrl, imageFilename(t.image!.publicUrl, t.id))
                    }
                  >
                    <Download size={14} />
                  </button>
                </div>
                {/* #20：图下方复制 */}
                <button
                  type="button"
                  className={styles.thumbCopy}
                  onClick={() => copyImage(t.image!.publicUrl)}
                >
                  <Copy size={12} />
                  复制
                </button>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );

  if (mode === "drawer") {
    return (
      <>
        <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
        {body}
      </>
    );
  }
  return body;
}
