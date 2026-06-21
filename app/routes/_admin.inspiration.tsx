import { Lightbulb, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { ApiError, apiPost } from "../../src/lib/api-client";
import {
  type AdminInspiration,
  listAllInspirations,
} from "../../src/server/admin/inspirations.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.inspiration";

// 后台灵感库 CRUD（09 §10.4）：列表 + 新增/编辑同一表单 + 删除二次确认；封面贴公有 URL。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const data = await listAllInspirations();
  return { data };
}

interface FormState {
  id: string | null; // null = 新增
  title: string;
  cover: string;
  category: string;
  prompt: string;
  summary: string;
  sort: string;
  active: boolean;
}

function emptyForm(): FormState {
  return { id: null, title: "", cover: "", category: "", prompt: "", summary: "", sort: "0", active: true };
}

function toForm(it: AdminInspiration): FormState {
  return {
    id: it.id,
    title: it.title,
    cover: it.cover,
    category: it.category ?? "",
    prompt: it.prompt,
    summary: it.summary ?? "",
    sort: String(it.sort),
    active: it.active,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData.data;
  const revalidator = useRevalidator();

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<AdminInspiration | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setFormErr(null);
    setForm(emptyForm());
  }
  function openEdit(it: AdminInspiration) {
    setFormErr(null);
    setForm(toForm(it));
  }
  function closeForm() {
    setForm(null);
    setFormErr(null);
  }

  async function submitForm() {
    if (!form) return;
    setSaving(true);
    setFormErr(null);
    const base = {
      title: form.title.trim(),
      cover: form.cover.trim(),
      category: form.category.trim() ? form.category.trim() : null,
      prompt: form.prompt.trim(),
      summary: form.summary.trim() ? form.summary.trim() : null,
      sort: Number.isFinite(Number(form.sort)) ? Math.trunc(Number(form.sort)) : 0,
      active: form.active,
    };
    try {
      if (form.id) {
        await apiPost("/api/admin/inspirations", { op: "update", id: form.id, ...base });
      } else {
        await apiPost("/api/admin/inspirations", { op: "create", ...base });
      }
      closeForm();
      revalidator.revalidate();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiPost("/api/admin/inspirations", { op: "delete", id: pendingDelete.id });
      setPendingDelete(null);
      revalidator.revalidate();
    } catch (e) {
      // 删除失败：关闭确认框、用 alert 兜底（行内无报错位）
      setPendingDelete(null);
      window.alert(e instanceof ApiError ? e.message : "删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>灵感库</h1>
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
            <Plus size={16} />
            新增
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <Lightbulb size={28} />
          <div>暂无灵感卡，点击「新增」添加第一张。</div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>封面</th>
                <th className={styles.th}>标题</th>
                <th className={styles.th}>品类</th>
                <th className={styles.th}>状态</th>
                <th className={styles.th}>排序</th>
                <th className={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={styles.tr}>
                  <td className={styles.td}>
                    {it.cover ? (
                      <img className={styles.thumb} src={it.cover} alt={it.title} />
                    ) : (
                      <div className={styles.thumbGhost} />
                    )}
                  </td>
                  <td className={styles.td}>{it.title}</td>
                  <td className={styles.td}>
                    {it.category ? it.category : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.td}>
                    {it.active ? (
                      <span className={`${styles.badge} ${styles.badgeOk}`}>上架</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeMuted}`}>下架</span>
                    )}
                  </td>
                  <td className={`${styles.td} ${styles.mono}`}>{it.sort}</td>
                  <td className={styles.td}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => openEdit(it)}
                      >
                        <Pencil size={14} />
                        编辑
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                        onClick={() => setPendingDelete(it)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form ? (
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
          onClick={closeForm}
        >
          <div
            className={styles.card}
            style={{ width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", margin: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? "编辑灵感卡" : "新增灵感卡"}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 className={styles.cardTitle}>{form.id ? "编辑灵感卡" : "新增灵感卡"}</h3>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={closeForm}>
                <X size={14} />
              </button>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-title">
                标题
              </label>
              <input
                id="insp-title"
                className={styles.input}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-cover">
                封面
              </label>
              <input
                id="insp-cover"
                className={styles.input}
                value={form.cover}
                onChange={(e) => setForm({ ...form, cover: e.target.value })}
                placeholder="https://…"
              />
              <span className={styles.muted} style={{ fontSize: 12 }}>
                公有图片 URL
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-category">
                品类
              </label>
              <input
                id="insp-category"
                className={styles.input}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-prompt">
                提示词
              </label>
              <textarea
                id="insp-prompt"
                className={styles.textarea}
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-summary">
                摘要
              </label>
              <textarea
                id="insp-summary"
                className={styles.textarea}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="insp-sort">
                排序
              </label>
              <input
                id="insp-sort"
                type="number"
                className={styles.input}
                value={form.sort}
                onChange={(e) => setForm({ ...form, sort: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                上架（展示给用户）
              </label>
            </div>

            {formErr ? <div className={`${styles.formMsg} ${styles.formErr}`}>{formErr}</div> : null}

            <div className={styles.rowActions} style={{ marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
              <button type="button" className={styles.btn} onClick={closeForm} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={submitForm}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除灵感卡"
        message={pendingDelete ? `确认删除「${pendingDelete.title}」？此操作不可撤销。` : undefined}
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
