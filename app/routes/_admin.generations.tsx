import { Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, useRevalidator } from "react-router";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { useLightbox } from "../../src/components/Lightbox/LightboxProvider";
import styles from "../../src/components/admin/Admin.module.css";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { formatTimer } from "../../src/lib/format";
import { listGenerations } from "../../src/server/admin/generations.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.generations";

// 后台「生成记录」（09 §10.5）：纯记录、不做收录。默认近 7 天；失败行直显报错码 + 文案 + HTTP 状态。
// #12：支持硬删（单删/批删，级联 images + 清 R2，二次确认）；账本保留。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const p = new URL(request.url).searchParams;
  const data = await listGenerations({
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    userEmail: p.get("userEmail") ?? undefined,
    status: p.get("status") ?? undefined,
    page: p.get("page") ? Number(p.get("page")) : undefined,
  });
  return { data, userEmail: p.get("userEmail") ?? "", status: p.get("status") ?? "" };
}

const STATUS_OPTIONS = ["succeeded", "failed", "running", "queued", "claimed"] as const;

function statusBadgeClass(status: string): string {
  if (status === "succeeded") return styles.badgeOk;
  if (status === "failed") return styles.badgeDanger;
  return styles.badgeWarn;
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { data, userEmail, status } = loaderData;
  const lb = useLightbox();
  const revalidator = useRevalidator();

  // #12 选择 + 删除
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const pageIds = data.items.map((g) => g.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (pageIds.every((id) => prev.has(id))) return new Set();
      return new Set(pageIds);
    });

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const ids = deleteTarget.ids;
      await apiPost<{ deleted: number }>(
        "/api/admin/generations",
        ids.length === 1
          ? { op: "delete_generation", id: ids[0] }
          : { op: "delete_generations_batch", ids },
      );
      setSelected(new Set());
      setDeleteTarget(null);
      revalidator.revalidate();
    } catch (e) {
      setDeleteErr(e instanceof ApiError ? e.message : "删除失败，请重试");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>生成记录</h1>
        <Form method="get" className={styles.toolbar}>
          <input
            type="text"
            name="userEmail"
            className={styles.search}
            placeholder="用户邮箱"
            defaultValue={userEmail}
            aria-label="用户邮箱"
          />
          <select name="status" className={styles.select} defaultValue={status} aria-label="状态">
            <option value="">全部</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            <Search size={14} />
            筛选
          </button>
        </Form>
      </div>

      <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 12 }}>
        <p className={styles.muted} style={{ fontSize: 13, margin: 0 }}>
          默认近 7 天，共 {data.total} 条
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
          disabled={selected.size === 0}
          onClick={() =>
            setDeleteTarget({ ids: [...selected], label: `选中的 ${selected.size} 条记录` })
          }
        >
          <Trash2 size={14} />
          删除选中{selected.size > 0 ? `（${selected.size}）` : ""}
        </button>
      </div>
      {deleteErr ? <div className={`${styles.formMsg} ${styles.formErr}`}>{deleteErr}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th} style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选本页"
                  style={{ cursor: "pointer" }}
                />
              </th>
              <th className={styles.th}>缩略图</th>
              <th className={styles.th}>用户</th>
              <th className={styles.th}>提示词</th>
              <th className={styles.th}>尺寸</th>
              <th className={styles.th}>时长</th>
              <th className={styles.th}>状态</th>
              <th className={styles.th}>时间</th>
              <th className={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id} className={styles.tr}>
                <td className={styles.td}>
                  <input
                    type="checkbox"
                    checked={selected.has(g.id)}
                    onChange={() => toggleOne(g.id)}
                    aria-label="选择此记录"
                    style={{ cursor: "pointer" }}
                  />
                </td>
                <td className={styles.td}>
                  {g.thumbUrl ? (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: 缩略图点击放大，键盘可走 lightbox 关闭
                    <img
                      className={styles.thumb}
                      src={g.thumbUrl}
                      alt=""
                      onClick={() => lb.open(g.thumbUrl as string, `图像工坊_${g.id}.png`)}
                    />
                  ) : (
                    <div className={styles.thumbGhost} aria-hidden />
                  )}
                </td>
                <td className={styles.td}>{g.email}</td>
                <td className={styles.td} style={{ maxWidth: 320 }}>
                  <div
                    title={g.prompt}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {g.prompt}
                  </div>
                  {g.status === "failed" && (g.errorCode || g.error || g.httpStatus != null) ? (
                    <div className={`${styles.mono} ${styles.badgeDanger}`} style={{ marginTop: 4 }}>
                      {[g.errorCode, g.error, g.httpStatus != null ? `HTTP ${g.httpStatus}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                </td>
                <td className={styles.td}>{g.size}</td>
                <td className={styles.td}>
                  {g.durationMs != null ? formatTimer(g.durationMs) : "—"}
                </td>
                <td className={styles.td}>
                  <span className={`${styles.badge} ${statusBadgeClass(g.status)}`}>{g.status}</span>
                </td>
                <td className={styles.td}>{new Date(g.createdAt).toLocaleString("zh-CN")}</td>
                <td className={styles.td}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                    onClick={() =>
                      setDeleteTarget({ ids: [g.id], label: "该条生成记录" })
                    }
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 ? <div className={styles.empty}>暂无生成记录</div> : null}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除生成记录"
        message={
          deleteTarget
            ? `将永久删除${deleteTarget.label}及其图片（同时清理对象存储），不可恢复。已扣积分的账本流水保留（对账不受影响）。`
            : undefined
        }
        confirmLabel="删除"
        danger
        busy={deleteBusy}
        onConfirm={onConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
