import { Check, Inbox, X } from "lucide-react";
import { useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { type AdminSubmissionRow, listSubmissions } from "../../src/server/admin/inspirationReview.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.inspiration-submissions";

// 后台灵感投稿审核（§13.1）：队列（按状态筛）+ 通过（可改字段→建上架卡）/ 驳回（填原因）。
const STATUS_TABS = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已驳回" },
  { value: "all", label: "全部" },
] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const data = await listSubmissions({ status });
  return { data, status };
}

interface ApproveForm {
  sub: AdminSubmissionRow;
  title: string;
  prompt: string;
  category: string;
  summary: string;
  active: boolean;
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { items, pending } = loaderData.data;
  const status = loaderData.status;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();

  const [approveForm, setApproveForm] = useState<ApproveForm | null>(null);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AdminSubmissionRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openApprove(s: AdminSubmissionRow) {
    setErr(null);
    setApproveForm({
      sub: s,
      title: s.title,
      prompt: s.prompt,
      category: s.category ?? "",
      summary: s.summary ?? "",
      active: true,
    });
  }

  async function doApprove() {
    if (!approveForm) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost("/api/admin/inspiration-submissions", {
        op: "approve",
        id: approveForm.sub.id,
        title: approveForm.title.trim(),
        prompt: approveForm.prompt.trim(),
        category: approveForm.category.trim() ? approveForm.category.trim() : null,
        summary: approveForm.summary.trim() ? approveForm.summary.trim() : null,
        active: approveForm.active,
      });
      setApproveConfirm(false);
      setApproveForm(null);
      revalidator.revalidate();
    } catch (e) {
      setApproveConfirm(false);
      setErr(e instanceof ApiError ? e.message : "通过失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await apiPost("/api/admin/inspiration-submissions", {
        op: "reject",
        id: rejectTarget.id,
        reason: rejectReason.trim(),
      });
      setRejectTarget(null);
      setRejectReason("");
      revalidator.revalidate();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "驳回失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>灵感投稿</h1>
        <div className={styles.toolbar}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`${styles.btn} ${styles.btnSm} ${status === t.value ? styles.btnPrimary : styles.btnGhost}`}
              onClick={() => setSearchParams(t.value === "pending" ? {} : { status: t.value })}
            >
              {t.label}
              {t.value === "pending" && pending > 0 ? `（${pending}）` : null}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <Inbox size={28} />
          <div>该状态下暂无投稿。</div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>图</th>
                <th className={styles.th}>提交人</th>
                <th className={styles.th}>标题</th>
                <th className={styles.th}>提示词</th>
                <th className={styles.th}>分类</th>
                <th className={styles.th}>状态</th>
                <th className={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className={styles.tr}>
                  <td className={styles.td}>
                    <a href={s.image} target="_blank" rel="noopener noreferrer">
                      <img className={styles.thumb} src={s.image} alt={s.title} />
                    </a>
                  </td>
                  <td className={styles.td}>{s.submitterEmail ?? <span className={styles.muted}>—</span>}</td>
                  <td className={styles.td}>{s.title}</td>
                  <td className={styles.td} style={{ maxWidth: 280 }}>
                    <span className={styles.muted} style={{ fontSize: 12 }}>
                      {s.prompt.length > 80 ? `${s.prompt.slice(0, 80)}…` : s.prompt}
                    </span>
                  </td>
                  <td className={styles.td}>
                    {s.category ? s.category : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.td}>
                    {s.status === "pending" ? (
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>待审核</span>
                    ) : s.status === "approved" ? (
                      <span className={`${styles.badge} ${styles.badgeOk}`}>已通过</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeMuted}`} title={s.reviewReason ?? ""}>
                        已驳回
                      </span>
                    )}
                  </td>
                  <td className={styles.td}>
                    {s.status === "pending" ? (
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
                          onClick={() => openApprove(s)}
                          disabled={busy}
                        >
                          <Check size={14} />
                          通过
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                          onClick={() => {
                            setRejectReason("");
                            setRejectTarget(s);
                          }}
                          disabled={busy}
                        >
                          <X size={14} />
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span className={styles.muted} style={{ fontSize: 12 }}>
                        {s.status === "rejected" && s.reviewReason ? `原因：${s.reviewReason}` : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 通过：可先改字段的编辑弹窗 */}
      {approveForm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "48px 16px",
            zIndex: 50,
            overflowY: "auto",
          }}
          onClick={() => setApproveForm(null)}
        >
          <div
            className={styles.card}
            style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", margin: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="通过投稿"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 className={styles.cardTitle}>通过投稿（可改后上架）</h3>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                onClick={() => setApproveForm(null)}
              >
                <X size={14} />
              </button>
            </div>

            <img
              src={approveForm.sub.image}
              alt={approveForm.title}
              style={{
                width: "100%",
                maxHeight: 220,
                objectFit: "contain",
                borderRadius: 8,
                border: "0.5px solid var(--border-subtle)",
                marginBottom: "var(--space-3)",
              }}
            />

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ap-title">
                标题
              </label>
              <input
                id="ap-title"
                className={styles.input}
                value={approveForm.title}
                onChange={(e) => setApproveForm({ ...approveForm, title: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ap-category">
                品类
              </label>
              <input
                id="ap-category"
                className={styles.input}
                value={approveForm.category}
                onChange={(e) => setApproveForm({ ...approveForm, category: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ap-prompt">
                提示词
              </label>
              <textarea
                id="ap-prompt"
                className={styles.textarea}
                value={approveForm.prompt}
                onChange={(e) => setApproveForm({ ...approveForm, prompt: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ap-summary">
                摘要
              </label>
              <textarea
                id="ap-summary"
                className={styles.textarea}
                value={approveForm.summary}
                onChange={(e) => setApproveForm({ ...approveForm, summary: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={approveForm.active}
                  onChange={(e) => setApproveForm({ ...approveForm, active: e.target.checked })}
                />
                立即上架（展示给用户）
              </label>
            </div>

            {err ? <div className={`${styles.formMsg} ${styles.formErr}`}>{err}</div> : null}

            <div className={styles.rowActions} style={{ marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
              <button type="button" className={styles.btn} onClick={() => setApproveForm(null)} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => setApproveConfirm(true)}
                disabled={busy || !approveForm.title.trim() || !approveForm.prompt.trim()}
              >
                通过并上架
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={approveConfirm}
        title="通过投稿"
        message={approveForm ? `确认通过「${approveForm.title}」并上架到灵感库？将公开展示并署名投稿人。` : undefined}
        confirmLabel="通过并上架"
        busy={busy}
        onConfirm={doApprove}
        onCancel={() => setApproveConfirm(false)}
      />

      {/* 驳回：填原因 */}
      {rejectTarget ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "48px 16px",
            zIndex: 50,
            overflowY: "auto",
          }}
          onClick={() => setRejectTarget(null)}
        >
          <div
            className={styles.card}
            style={{ width: "100%", maxWidth: 440, margin: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="驳回投稿"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 className={styles.cardTitle}>驳回投稿</h3>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                onClick={() => setRejectTarget(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rj-reason">
                驳回原因（会通知投稿人）
              </label>
              <textarea
                id="rj-reason"
                className={styles.textarea}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="如：与平台调性不符 / 画面不清晰 / 涉及敏感内容…"
              />
            </div>
            <div className={styles.rowActions} style={{ marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
              <button type="button" className={styles.btn} onClick={() => setRejectTarget(null)} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={doReject}
                disabled={busy || !rejectReason.trim()}
              >
                确认驳回
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
