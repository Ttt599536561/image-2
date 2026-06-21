import { Search } from "lucide-react";
import { Form } from "react-router";
import { useLightbox } from "../../src/components/Lightbox/LightboxProvider";
import styles from "../../src/components/admin/Admin.module.css";
import { formatTimer } from "../../src/lib/format";
import { listGenerations } from "../../src/server/admin/generations.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.generations";

// 后台「生成记录」（09 §10.5）：纯记录、不做收录。默认近 7 天；失败行直显报错码 + 文案 + HTTP 状态。READ-ONLY。
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

      <p className={styles.muted} style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        默认近 7 天，共 {data.total} 条
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>缩略图</th>
              <th className={styles.th}>用户</th>
              <th className={styles.th}>提示词</th>
              <th className={styles.th}>尺寸</th>
              <th className={styles.th}>时长</th>
              <th className={styles.th}>状态</th>
              <th className={styles.th}>时间</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id} className={styles.tr}>
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
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 ? <div className={styles.empty}>暂无生成记录</div> : null}
      </div>
    </>
  );
}
