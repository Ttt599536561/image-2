import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Images, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { LandingImageUploadResponse } from "../../src/contracts/admin";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { ApiError, apiPost, apiPostForm } from "../../src/lib/api-client";
import {
  type AdminLandingItem,
  listAllLandingItems,
} from "../../src/server/admin/landing-gallery.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.landing-gallery";

/** 客户端读图片原始尺寸（瀑布流原比例自动回填，全格式通用）。 */
function readImageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read dims failed"));
    };
    img.src = url;
  });
}

// 后台首页画廊 CRUD（F-073）：手动配置未登录 /welcome 展示图。
// 列表 + 新增/编辑同一表单 + 删除二次确认；图片本地上传或贴公有 URL。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const data = await listAllLandingItems();
  return { data };
}

interface FormState {
  id: string | null; // null = 新增
  title: string;
  image: string;
  category: string;
  prompt: string;
  summary: string;
  width: string; // 图片宽高（可空，可「从图片探测」自动回填）
  height: string;
  sort: string;
  active: boolean;
}

function emptyForm(): FormState {
  return { id: null, title: "", image: "", category: "", prompt: "", summary: "", width: "", height: "", sort: "0", active: true };
}

function toForm(it: AdminLandingItem): FormState {
  return {
    id: it.id,
    title: it.title,
    image: it.image,
    category: it.category ?? "",
    prompt: it.prompt,
    summary: it.summary ?? "",
    width: it.width != null ? String(it.width) : "",
    height: it.height != null ? String(it.height) : "",
    sort: String(it.sort),
    active: it.active,
  };
}

/** 表单整数字段 → number | null（空/非法 → null）。 */
function posIntOrNull(s: string): number | null {
  const n = Math.trunc(Number(s));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData.data;
  const revalidator = useRevalidator();

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<AdminLandingItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null); // 行内操作（上下移/上下架）进行中的卡 id
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);

  // 选本地图片 → 客户端读尺寸自动回填宽高 + 上传换公有 URL 填进 image（image_key 由服务端据 image_url 派生）。
  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重选同一文件再次触发
    if (!file || !form) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFormErr("仅支持 PNG / JPG / WEBP 图片");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFormErr("图片过大（上限 4MB）");
      return;
    }
    setImageUploading(true);
    setFormErr(null);
    const dims = await readImageDims(file).catch(() => null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiPostForm("/api/admin/landing-gallery/upload", fd, LandingImageUploadResponse);
      setForm((f) =>
        f ? { ...f, image: res.imageUrl, ...(dims ? { width: String(dims.w), height: String(dims.h) } : {}) } : f,
      );
    } catch (err) {
      setFormErr(err instanceof ApiError ? err.message : "上传失败，请重试");
    } finally {
      setImageUploading(false);
    }
  }

  function openCreate() {
    setFormErr(null);
    setForm(emptyForm());
  }
  function openEdit(it: AdminLandingItem) {
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
      image: form.image.trim(),
      category: form.category.trim() ? form.category.trim() : null,
      prompt: form.prompt.trim(), // 可空（门面图不强制提示词）
      summary: form.summary.trim() ? form.summary.trim() : null,
      width: posIntOrNull(form.width),
      height: posIntOrNull(form.height),
      sort: Number.isFinite(Number(form.sort)) ? Math.trunc(Number(form.sort)) : 0,
      active: form.active,
    };
    try {
      if (form.id) {
        await apiPost("/api/admin/landing-gallery", { op: "update", id: form.id, ...base });
      } else {
        await apiPost("/api/admin/landing-gallery", { op: "create", ...base });
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
      await apiPost("/api/admin/landing-gallery", { op: "delete", id: pendingDelete.id });
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

  // 从图片 URL 探测原始宽高（纯客户端 Image；仅在两者为空时回填，不覆盖手填值）。
  function detectDims() {
    if (!form) return;
    const url = form.image.trim();
    if (!url) {
      setFormErr("请先填写图片 URL");
      return;
    }
    setFormErr(null);
    const img = new window.Image();
    img.onload = () =>
      setForm((f) =>
        f ? { ...f, width: String(img.naturalWidth), height: String(img.naturalHeight) } : f,
      );
    img.onerror = () => setFormErr("无法加载图片，无法探测尺寸");
    img.src = url;
  }

  // 快捷上/下架（不开整表单）：复用 update op 翻转 active，回填该卡全字段。
  async function toggleActive(it: AdminLandingItem) {
    setRowBusy(it.id);
    try {
      await apiPost("/api/admin/landing-gallery", {
        op: "update",
        id: it.id,
        title: it.title,
        image: it.image,
        category: it.category,
        prompt: it.prompt,
        summary: it.summary,
        width: it.width,
        height: it.height,
        sort: it.sort,
        active: !it.active,
      });
      revalidator.revalidate();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "操作失败，请重试");
    } finally {
      setRowBusy(null);
    }
  }

  // 上/下移一位（互换相邻并规整 sort）。
  async function move(it: AdminLandingItem, direction: "up" | "down") {
    setRowBusy(it.id);
    try {
      await apiPost("/api/admin/landing-gallery", { op: "reorder", id: it.id, direction });
      revalidator.revalidate();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "排序失败，请重试");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>首页画廊</h1>
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
            <Plus size={16} />
            新增
          </button>
        </div>
      </div>

      <p className={styles.muted} style={{ marginTop: 0 }}>
        未登录访客打开首页（/welcome）看到的画廊图片。上架卡片按「排序」从小到大展示；
        一张上架卡都没有时，首页自动回退为灵感库内容。
      </p>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <Images size={28} />
          <div>暂无画廊图，点击「新增」配置第一张；不配置时首页展示灵感库内容。</div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>图片</th>
                <th className={styles.th}>标题</th>
                <th className={styles.th}>品类</th>
                <th className={styles.th}>状态</th>
                <th className={styles.th}>排序</th>
                <th className={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id} className={styles.tr}>
                  <td className={styles.td}>
                    {it.image ? (
                      <img className={styles.thumb} src={it.image} alt={it.title} />
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
                  <td className={`${styles.td} ${styles.mono}`}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => move(it, "up")}
                        disabled={i === 0 || rowBusy !== null}
                        title="上移"
                        aria-label="上移"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => move(it, "down")}
                        disabled={i === items.length - 1 || rowBusy !== null}
                        title="下移"
                        aria-label="下移"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <span className={`${styles.muted} ${styles.mono}`}>{it.sort}</span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                        onClick={() => toggleActive(it)}
                        disabled={rowBusy !== null}
                      >
                        {it.active ? <EyeOff size={14} /> : <Eye size={14} />}
                        {it.active ? "下架" : "上架"}
                      </button>
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
            aria-label={form.id ? "编辑画廊图" : "新增画廊图"}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 className={styles.cardTitle}>{form.id ? "编辑画廊图" : "新增画廊图"}</h3>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={closeForm}>
                <X size={14} />
              </button>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-title">
                标题
              </label>
              <input
                id="landing-title"
                className={styles.input}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-image">
                图片
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                  onClick={() => imageFileRef.current?.click()}
                  disabled={imageUploading}
                >
                  <ImagePlus size={14} />
                  {imageUploading ? "上传中…" : "上传图片"}
                </button>
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={onImageFile}
                />
                {form.image ? (
                  <img
                    src={form.image}
                    alt="图片预览"
                    onError={(e) => {
                      e.currentTarget.style.display = "none"; // 坏 URL：隐藏破图（上传路径不会触发；仅粘贴坏链时）
                    }}
                    style={{
                      width: 40,
                      height: 40,
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "0.5px solid var(--border-subtle)",
                    }}
                  />
                ) : null}
              </div>
              <input
                id="landing-image"
                className={styles.input}
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="或粘贴公有图片 URL"
              />
              <span className={styles.muted} style={{ fontSize: 12 }}>
                本地上传图片，或粘贴公有图片 URL
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>图片尺寸（瀑布流原比例，可空）</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  className={styles.input}
                  style={{ width: 96 }}
                  value={form.width}
                  onChange={(e) => setForm({ ...form, width: e.target.value })}
                  placeholder="宽"
                  aria-label="图片宽"
                />
                <span className={styles.muted}>×</span>
                <input
                  type="number"
                  min={1}
                  className={styles.input}
                  style={{ width: 96 }}
                  value={form.height}
                  onChange={(e) => setForm({ ...form, height: e.target.value })}
                  placeholder="高"
                  aria-label="图片高"
                />
                <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={detectDims}>
                  从图片探测
                </button>
              </div>
              <span className={styles.muted} style={{ fontSize: 12 }}>
                留空则画廊按图片自然尺寸加载（可能有轻微抖动）
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-category">
                品类
              </label>
              <input
                id="landing-category"
                className={styles.input}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-prompt">
                提示词（可空）
              </label>
              <textarea
                id="landing-prompt"
                className={styles.textarea}
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-summary">
                摘要
              </label>
              <textarea
                id="landing-summary"
                className={styles.textarea}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="landing-sort">
                排序
              </label>
              <input
                id="landing-sort"
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
                上架（展示在未登录首页）
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
        title="删除画廊图"
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
