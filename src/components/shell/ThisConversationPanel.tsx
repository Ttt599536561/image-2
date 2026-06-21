import { Download, X } from "lucide-react";
import { useLightbox } from "../Lightbox/LightboxProvider";
import type { Turn } from "../../mocks/types";
import styles from "./ThisConversationPanel.module.css";

function downloadImage(src: string, name: string) {
  const a = document.createElement("a");
  a.href = src;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ThisConversationPanel({
  turns,
  mode,
  onClose,
}: {
  turns: Turn[];
  mode: "column" | "drawer";
  onClose?: () => void;
}) {
  const lightbox = useLightbox();
  const images = turns.filter((t) => t.status === "succeeded" && t.image).slice().reverse();

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
                images.forEach((t, i) =>
                  t.image ? downloadImage(t.image.publicUrl, `图像工坊_${i + 1}.svg`) : null,
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
