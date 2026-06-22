import { Eye, Megaphone, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { classifyAnnouncementLink } from "../../src/lib/announcementLink";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { formatMonthDayTime } from "../../src/lib/format";
import {
  type AnnouncementSummary,
  listAnnouncements,
  notificationTargetCounts,
} from "../../src/server/admin/notifications.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.notifications";

// 后台广播公告（§9）：撰写 title/body/link + 选目标（全体/付费）+ 二次确认「将给 N 个用户下发」+ 审计。
// ①增强（2026-06-22）：撰写区下方「已发公告」列表 —— 编辑（回填表单 + 可勾「重新提醒」）/ 删除（同步用户端）。
// 双守卫：_admin 布局 requireAdminPage + api.admin.notifications 各自 requireAdmin。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const [counts, announcements] = await Promise.all([
    notificationTargetCounts(),
    listAnnouncements(),
  ]);
  return { counts, announcements: announcements.items };
}

type Target = "all" | "paid";
type Mode = "broadcast" | "edit";

const targetLabel = (t: Target | null): string =>
  t === "paid" ? "仅付费" : t === "all" ? "全体" : "—";

export default function Page({ loaderData }: Route.ComponentProps) {
  const { counts, announcements } = loaderData;
  const revalidator = useRevalidator();

  const [mode, setMode] = useState<Mode>("broadcast");
  const [editAid, setEditAid] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [target, setTarget] = useState<Target>("all");
  const [renotify, setRenotify] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<AnnouncementSummary | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const isEdit = mode === "edit";
  const targetCount = target === "paid" ? counts.paid : counts.all;

  // link 前端校验（与后端 announcementLink 同一分类器）：空 或 站内单层路径 或 http(s) 外链。
  const linkValid = (() => {
    const l = link.trim();
    return !l || classifyAnnouncementLink(l) !== null;
  })();
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && linkValid;

  // 开始撰写下一条时清掉上次的成功提示，避免旧 banner 残留误读。
  const onEditField = (set: (v: string) => void) => (v: string) => {
    if (okMsg) setOkMsg(null);
    set(v);
  };

  function resetForm() {
    setMode("broadcast");
    setEditAid(null);
    setTitle("");
    setBody("");
    setLink("");
    setTarget("all");
    setRenotify(false);
  }

  function startEdit(a: AnnouncementSummary) {
    setErr(null);
    setOkMsg(null);
    setMode("edit");
    setEditAid(a.aid);
    setTitle(a.title);
    setBody(a.body);
    setLink(a.link ?? "");
    setRenotify(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openConfirm() {
    setErr(null);
    setOkMsg(null);
    if (!title.trim()) return setErr("标题必填");
    if (!body.trim()) return setErr("内容必填");
    if (!linkValid) return setErr("链接须为站内路径(/…)或 http(s) 外链");
    setConfirming(true);
  }

  async function doSubmit() {
    setSending(true);
    setErr(null);
    const trimmedLink = link.trim() ? link.trim() : null;
    try {
      if (isEdit && editAid) {
        const res = await apiPost<{ ok: boolean; affected: number }>(
          "/api/admin/notifications",
          { op: "edit", aid: editAid, title: title.trim(), body: body.trim(), link: trimmedLink, renotify },
        );
        setConfirming(false);
        resetForm();
        setOkMsg(`已更新 ${res.affected} 条公告${renotify ? "（已重新提醒）" : ""}。`);
      } else {
        const res = await apiPost<{ ok: boolean; inserted: number }>("/api/admin/notifications", {
          op: "broadcast",
          title: title.trim(),
          body: body.trim(),
          link: trimmedLink,
          target,
        });
        setConfirming(false);
        resetForm();
        setOkMsg(`已下发给 ${res.inserted} 个用户。`);
      }
      revalidator.revalidate();
    } catch (e) {
      setConfirming(false);
      setErr(e instanceof ApiError ? e.message : "操作失败，请重试");
    } finally {
      setSending(false);
    }
  }

  async function doDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    setErr(null);
    const a = deleting;
    try {
      const res = await apiPost<{ ok: boolean; affected: number }>("/api/admin/notifications", {
        op: "delete",
        aid: a.aid,
      });
      setDeleting(null);
      if (editAid === a.aid) resetForm(); // 正在编辑的那条被删 → 退出编辑态
      setOkMsg(`已删除公告「${a.title}」（移除 ${res.affected} 条）。`);
      revalidator.revalidate();
    } catch (e) {
      setDeleting(null);
      setErr(e instanceof ApiError ? e.message : "删除失败，请重试");
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>广播公告</h1>
      </div>

      <div className={styles.card} style={{ maxWidth: 560 }}>
        <h3 className={styles.cardTitle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isEdit ? <Pencil size={16} /> : <Megaphone size={16} />}
          {isEdit ? "编辑公告" : "撰写公告"}
        </h3>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ann-title">
            标题
          </label>
          <input
            id="ann-title"
            className={styles.input}
            value={title}
            maxLength={120}
            onChange={(e) => onEditField(setTitle)(e.target.value)}
            placeholder="如：系统维护通知"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ann-body">
            内容
          </label>
          <textarea
            id="ann-body"
            className={styles.textarea}
            value={body}
            maxLength={2000}
            onChange={(e) => onEditField(setBody)(e.target.value)}
            placeholder="公告正文（铃铛内展示，最多 2 行摘要）"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ann-link">
            跳转链接（可空）
          </label>
          <input
            id="ann-link"
            className={styles.input}
            value={link}
            maxLength={1000}
            onChange={(e) => onEditField(setLink)(e.target.value)}
            placeholder="/billing 或 https://…"
          />
          <span className={styles.muted} style={{ fontSize: 12 }}>
            站内路径（/ 开头，点击站内跳转）或 http(s) 外链（新窗口打开）；留空则公告不可点跳。
          </span>
        </div>

        {isEdit ? (
          <div className={styles.field}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={renotify}
                onChange={(e) => setRenotify(e.target.checked)}
              />
              重新提醒（重置已读、重弹红点）
            </label>
            <span className={styles.muted} style={{ fontSize: 12 }}>
              不勾选 = 静默更新内容（不打扰已读用户）；勾选 = 这条公告对所有收到者重新标为未读。
            </span>
          </div>
        ) : (
          <div className={styles.field}>
            <span className={styles.label}>下发目标</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input
                type="radio"
                name="ann-target"
                checked={target === "all"}
                onChange={() => setTarget("all")}
              />
              全体用户（{counts.all}）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name="ann-target"
                checked={target === "paid"}
                onChange={() => setTarget("paid")}
              />
              仅付费用户（{counts.paid}）
            </label>
          </div>
        )}

        {err ? <div className={`${styles.formMsg} ${styles.formErr}`}>{err}</div> : null}
        {okMsg ? <div className={`${styles.formMsg} ${styles.formOk}`}>{okMsg}</div> : null}

        <div
          className={styles.rowActions}
          style={{ justifyContent: "flex-end", marginTop: "var(--space-4)" }}
        >
          {isEdit ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={resetForm}
              disabled={sending}
            >
              取消编辑
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={openConfirm}
            disabled={!canSubmit || sending}
          >
            {isEdit ? <Pencil size={15} /> : <Send size={15} />}
            {isEdit ? "保存修改" : "下发"}
          </button>
        </div>
      </div>

      <div className={styles.card} style={{ maxWidth: 640 }}>
        <h3 className={styles.cardTitle}>已发公告</h3>
        {announcements.length === 0 ? (
          <div className={styles.empty}>还没有发过公告。在上方撰写并下发吧。</div>
        ) : (
          <div className={styles.annList}>
            {announcements.map((a) => (
              <div
                key={a.aid}
                className={`${styles.annRow} ${editAid === a.aid ? styles.annRowEditing : ""}`}
              >
                <Megaphone size={16} style={{ color: "var(--accent)", flex: "none" }} />
                <div className={styles.annInfo}>
                  <div className={styles.annTitle}>{a.title || "（无标题）"}</div>
                  <div className={styles.annMeta}>
                    {targetLabel(a.target)} · {formatMonthDayTime(a.createdAt)} ·{" "}
                    <Eye size={11} style={{ verticalAlign: -1 }} /> 已读 {a.readCount}/{a.recipients}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.annIconBtn}
                  onClick={() => startEdit(a)}
                  aria-label="编辑"
                  title="编辑"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className={`${styles.annIconBtn} ${styles.annIconBtnDanger}`}
                  onClick={() => setDeleting(a)}
                  aria-label="删除"
                  title="删除"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={isEdit ? "确认保存修改？" : "确认下发公告？"}
        message={
          isEdit
            ? `将更新这条公告在所有收到者铃铛中的内容${renotify ? "，并对全部收到者重新提醒（重弹红点）" : "（静默更新、不打扰已读用户）"}。`
            : `将给 ${targetCount} 个${target === "paid" ? "付费" : ""}用户下发公告「${title.trim()}」。下发后用户铃铛即可见，不可撤回。`
        }
        confirmLabel={isEdit ? "保存修改" : "确认下发"}
        busy={sending}
        onConfirm={doSubmit}
        onCancel={() => setConfirming(false)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="确认删除公告？"
        message={
          deleting
            ? `将从 ${deleting.recipients} 个用户的铃铛中移除公告「${deleting.title}」，不可撤回。`
            : ""
        }
        confirmLabel="删除"
        danger
        busy={deletingBusy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
