import { ArrowRight, ExternalLink, Megaphone } from "lucide-react";
import { useEffect } from "react";
import type { AnnouncementLinkKind } from "../../lib/announcementLink";
import { formatMonthDayTime } from "../../lib/format";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import styles from "./AnnouncementModal.module.css";

// ②（2026-06-22）：用户端公告详情弹窗。点铃铛里的 announcement → 弹此 Modal（完整 title/body/link/时间 + 知道了）。
// 关闭不删通知（看完仍保留在铃铛中）；遮罩内 flex 居中 + ESC/点遮罩关闭 + 锁背景滚动（同 ConfirmDialog 范式）。
export interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  link: string | null;
  linkKind: AnnouncementLinkKind | null;
  createdAt: string;
}

export function AnnouncementModal({
  detail,
  onClose,
  onGoLink,
}: {
  detail: AnnouncementDetail;
  onClose: () => void;
  onGoLink: (link: string, kind: AnnouncementLinkKind) => void;
}) {
  useLockBodyScroll(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasLink = !!(detail.link && detail.linkKind);

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={detail.title || "站长公告"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.iconWrap}>
            <Megaphone size={16} />
          </span>
          <h3 className={styles.title}>{detail.title || "站长公告"}</h3>
        </div>

        <p className={styles.body}>{detail.body}</p>
        <p className={styles.time}>{formatMonthDayTime(detail.createdAt)}</p>

        <div className={styles.actions}>
          {hasLink ? (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => detail.link && detail.linkKind && onGoLink(detail.link, detail.linkKind)}
            >
              {detail.linkKind === "external" ? <ExternalLink size={15} /> : <ArrowRight size={15} />}
              查看
            </button>
          ) : (
            <span />
          )}
          <button type="button" className={styles.confirm} onClick={onClose}>
            知道了
          </button>
        </div>

        <p className={styles.foot}>关闭后公告仍保留在铃铛中，可重复查看</p>
      </div>
    </div>
  );
}
