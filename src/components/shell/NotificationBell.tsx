import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Clock, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { NotificationItem, NotificationListResponse } from "../../contracts/notification";
import { useNotifications } from "../../hooks/queries";
import { type AnnouncementLinkKind, classifyAnnouncementLink } from "../../lib/announcementLink";
import { apiPost } from "../../lib/api-client";
import { formatMonthDay } from "../../lib/format";
import { usePopover } from "../../lib/usePopover";
import { type AnnouncementDetail, AnnouncementModal } from "./AnnouncementModal";
import styles from "./NotificationBell.module.css";

// 顶栏通知铃铛（08 §9.6 / §9 / ②）。两类：image_expiring（payload {imageId, expiresAt}，点跳资产库）
// + announcement（后台广播，payload {title, body, link?}，点弹详情 Modal）。
// ②（2026-06-22）：拉近 50 条「全部」（含已读）——红点只计未读、打开消红点但**条目仍保留**可反复点开；
// 已读灰显。打开时冻结快照保留高亮稳定，关闭后下次打开按最新已读态灰显。
export function NotificationBell({ buttonClassName }: { buttonClassName?: string }) {
  const pop = usePopover();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useNotifications();
  const items = data?.items ?? [];
  const unreadCount = items.filter((n) => n.readAt === null).length;
  // 打开时冻结一份快照展示：标记已读会 invalidate 刷新 items（已读态变化），但当前下拉保持快照高亮稳定。
  const [frozen, setFrozen] = useState<NotificationItem[] | null>(null);
  const display = frozen ?? items;
  const [detail, setDetail] = useState<AnnouncementDetail | null>(null);

  // ⚡ 乐观更新：打开铃铛即把未读就地置已读，红点立即消失（不等跨境往返）。失败回滚，onSettled 兜底对齐。
  const markRead = useMutation({
    mutationFn: () => apiPost("/api/notifications/read", {}),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<NotificationListResponse>(["notifications"]);
      const now = new Date().toISOString();
      qc.setQueryData<NotificationListResponse>(["notifications"], (old) =>
        old ? { ...old, items: old.items.map((n) => (n.readAt ? n : { ...n, readAt: now })) } : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // 任何路径关闭浮层（toggle / 外部点击 / ESC / 点条目）都清掉冻结快照。
  useEffect(() => {
    if (!pop.open) setFrozen(null);
  }, [pop.open]);

  const toggle = () => {
    const willOpen = !pop.open;
    pop.setOpen(willOpen);
    if (willOpen) {
      setFrozen(items); // 冻结当前快照
      if (unreadCount > 0 && !markRead.isPending) markRead.mutate(); // 标记已读 → 红点消（条目保留）
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

  // 点公告 → 关浮层、弹详情 Modal（不删通知、看完仍保留）。
  const openDetail = (n: NotificationItem) => {
    const a = announcementOf(n.payload);
    pop.setOpen(false);
    setDetail({
      id: n.id,
      title: a.title,
      body: a.body,
      link: a.link,
      linkKind: a.linkKind,
      createdAt: n.createdAt,
    });
  };

  const goLink = (link: string, kind: AnnouncementLinkKind) => {
    setDetail(null);
    if (kind === "internal") navigate(link); // 站内路径
    else window.open(link, "_blank", "noopener,noreferrer"); // http(s) 外链新开
  };

  return (
    <div className={styles.wrap} ref={pop.ref}>
      <button type="button" className={buttonClassName} onClick={toggle} aria-label="通知" title="通知">
        <Bell size={17} />
        {unreadCount > 0 ? (
          <span className={styles.badge}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </button>
      {pop.open ? (
        <div className={styles.dropdown} role="menu">
          <div className={styles.header}>通知</div>
          {display.length === 0 ? (
            <div className={styles.empty}>暂无通知</div>
          ) : (
            display.map((n) => {
              const isRead = n.readAt !== null;
              const itemCls = `${styles.item} ${isRead ? styles.itemRead : styles.itemUnread}`;
              if (n.type === "announcement") {
                const a = announcementOf(n.payload);
                return (
                  <button key={n.id} type="button" className={itemCls} onClick={() => openDetail(n)}>
                    <Megaphone size={14} className={styles.itemIconAnnounce} />
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{a.title || "站长公告"}</span>
                      {a.body ? <span className={styles.itemSummary}>{a.body}</span> : null}
                      <span className={styles.itemTime}>
                        {formatMonthDay(n.createdAt)} · 点此查看
                      </span>
                    </span>
                  </button>
                );
              }
              // image_expiring（点跳资产库；条目同样保留）
              const exp = expiresOf(n.payload);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={itemCls}
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
      {detail ? (
        <AnnouncementModal detail={detail} onClose={() => setDetail(null)} onGoLink={goLink} />
      ) : null}
    </div>
  );
}
