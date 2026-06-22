import { Megaphone, Send } from "lucide-react";
import { useState } from "react";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { classifyAnnouncementLink } from "../../src/lib/announcementLink";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { notificationTargetCounts } from "../../src/server/admin/notifications.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.notifications";

// 后台广播公告（§9）：撰写 title/body/link + 选目标（全体/付费）+ 二次确认「将给 N 个用户下发」+ 审计（server 层）。
// 双守卫：_admin 布局 requireAdminPage + api.admin.notifications 各自 requireAdmin。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const counts = await notificationTargetCounts();
  return { counts };
}

type Target = "all" | "paid";

export default function Page({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [target, setTarget] = useState<Target>("all");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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

  function openConfirm() {
    setErr(null);
    setOkMsg(null);
    if (!title.trim()) return setErr("标题必填");
    if (!body.trim()) return setErr("内容必填");
    if (!linkValid) return setErr("链接须为站内路径(/…)或 http(s) 外链");
    setConfirming(true);
  }

  async function doSend() {
    setSending(true);
    setErr(null);
    try {
      const res = await apiPost<{ ok: boolean; inserted: number }>("/api/admin/notifications", {
        op: "broadcast",
        title: title.trim(),
        body: body.trim(),
        link: link.trim() ? link.trim() : null,
        target,
      });
      setConfirming(false);
      setOkMsg(`已下发给 ${res.inserted} 个用户。`);
      setTitle("");
      setBody("");
      setLink("");
    } catch (e) {
      setConfirming(false);
      setErr(e instanceof ApiError ? e.message : "下发失败，请重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>广播公告</h1>
      </div>

      <div className={styles.card} style={{ maxWidth: 560 }}>
        <h3 className={styles.cardTitle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Megaphone size={16} />
          撰写公告
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

        {err ? <div className={`${styles.formMsg} ${styles.formErr}`}>{err}</div> : null}
        {okMsg ? <div className={`${styles.formMsg} ${styles.formOk}`}>{okMsg}</div> : null}

        <div
          className={styles.rowActions}
          style={{ justifyContent: "flex-end", marginTop: "var(--space-4)" }}
        >
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={openConfirm}
            disabled={!canSubmit || sending}
          >
            <Send size={15} />
            下发
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="确认下发公告？"
        message={`将给 ${targetCount} 个${target === "paid" ? "付费" : ""}用户下发公告「${title.trim()}」。下发后用户铃铛即可见，不可撤回。`}
        confirmLabel="确认下发"
        busy={sending}
        onConfirm={doSend}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
