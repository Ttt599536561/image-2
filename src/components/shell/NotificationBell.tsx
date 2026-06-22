import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock, Megaphone } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { NotificationItem } from "../../contracts/notification";
import { useNotifications } from "../../hooks/queries";
import { type AnnouncementLinkKind, classifyAnnouncementLink } from "../../lib/announcementLink";
import { apiPost } from "../../lib/api-client";
import { formatMonthDay } from "../../lib/format";
import { usePopover } from "../../lib/usePopover";
import styles from "./NotificationBell.module.css";

// 顶栏通知铃铛（08 §9.6）。未读红点 + 下拉未读列表；打开即标记全部已读 → invalidate 消红点。
// 两类：image_expiring（payload {imageId, expiresAt}，点跳资产库）+ announcement（后台广播，payload {title, body, link?}）。
export function NotificationBell({ buttonClassName }: { buttonClassName?: string }) {
  const pop = usePopover();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useNotifications();
  const items = data?.items ?? [];
  const count = items.length;
  // 打开时冻结一份列表展示（标记已读会 invalidate 清空未读 query + 消红点，但当前下拉仍需可见）。
  const [frozen, setFrozen] = useState<NotificationItem[] | null>(null);
  const display = pop.open ? (frozen ?? items) : items;

  const markRead = useMutation({
    mutationFn: () => apiPost("/api/notifications/read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const toggle = () => {
    const willOpen = !pop.open;
    pop.setOpen(willOpen);
    if (willOpen) {
      setFrozen(items); // 冻结当前未读供展示
      if (count > 0 && !markRead.isPending) markRead.mutate(); // 标记已读 → 红点消
    } else {
      setFrozen(null);
    }
  };

  const expiresOf = (payload: Record<string, unknown> | null): string | null => {
    const v = payload?.expiresAt;
    return typeof v === "string" ? v : null;
  };

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const announcementOf = (payload: Record<string, unknown> | null) => {
    const raw = str(payload?.link);
    // 与后端 announcementLink 同一分类器二次校验（挡 javascript:/协议相对 //evil/反斜杠 /\evil）。
    const linkKind = raw ? classifyAnnouncementLink(raw) : null;
    return {
      title: str(payload?.title),
      body: str(payload?.body),
      link: linkKind ? raw : null,
      linkKind,
    };
  };

  const goAnnouncement = (link: string | null, kind: AnnouncementLinkKind | null) => {
    pop.setOpen(false);
    if (!link || !kind) return;
    if (kind === "internal") navigate(link); // 站内路径
    else window.open(link, "_blank", "noopener,noreferrer"); // http(s) 外链新开
  };

  return (
    <div className={styles.wrap} ref={pop.ref}>
      <button type="button" className={buttonClassName} onClick={toggle} aria-label="通知" title="通知">
        <Bell size={17} />
        {count > 0 ? (
          <span className={styles.badge}>{count > 9 ? "9+" : count}</span>
        ) : null}
      </button>
      {pop.open ? (
        <div className={styles.dropdown} role="menu">
          <div className={styles.header}>通知</div>
          {display.length === 0 ? (
            <div className={styles.empty}>暂无新通知</div>
          ) : (
            display.map((n) => {
              if (n.type === "announcement") {
                const a = announcementOf(n.payload);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={styles.item}
                    onClick={() => goAnnouncement(a.link, a.linkKind)}
                  >
                    <Megaphone size={14} className={styles.itemIconAnnounce} />
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{a.title || "站长公告"}</span>
                      {a.body ? <span className={styles.itemSummary}>{a.body}</span> : null}
                      <span className={styles.itemTime}>
                        {formatMonthDay(n.createdAt)}
                        {a.link ? " · 点此查看" : ""}
                      </span>
                    </span>
                  </button>
                );
              }
              // image_expiring
              const exp = expiresOf(n.payload);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    pop.setOpen(false);
                    navigate("/assets");
                  }}
                >
                  <Clock size={14} className={styles.itemIcon} />
                  <span className={styles.itemBody}>
                    <span className={styles.itemTitle}>
                      有图片将于 {exp ? formatMonthDay(exp) : "近期"} 过期
                    </span>
                    <span className={styles.itemTime}>{formatMonthDay(n.createdAt)} · 点此查看资产库</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
