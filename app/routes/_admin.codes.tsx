import { Download, RefreshCw, Search, Ticket } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { ApiError, apiGet, apiPost } from "../../src/lib/api-client";
import { formatCash, formatCredits, formatValidDays } from "../../src/lib/format";
import { listBatches } from "../../src/server/admin/codes.server";
import { listAllPackages } from "../../src/server/admin/packages.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.codes";

// 兑换码管理（09 §10.2）：批量生成 / 查单 / 批次列表（导出 CSV·对账·作废）。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const p = new URL(request.url).searchParams;
  const [batches, pkgs] = await Promise.all([
    listBatches(Math.max(1, Number(p.get("page") ?? 1) || 1)),
    listAllPackages(),
  ]);
  return { batches, packages: pkgs.items };
}

type Batch = Route.ComponentProps["loaderData"]["batches"]["items"][number];

interface CodeStatus {
  code: string;
  status: string;
  creditsValueMp: number;
  cashValue: number;
  validDays: number | null;
  batchId: string | null;
  redeemedByEmail: string | null;
  redeemedAt: string | null;
}

interface Reconcile {
  issued: number;
  used: number;
  unused: number;
  disabled: number;
  revenueCash: string;
  issuedCash: string;
}

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case "active":
      return { cls: styles.badgeOk, label: "未使用" };
    case "redeemed":
      return { cls: styles.badgeMuted, label: "已兑换" };
    case "disabled":
      return { cls: styles.badgeDanger, label: "已作废" };
    default:
      return { cls: styles.badgeMuted, label: status };
  }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { batches, packages } = loaderData;
  const revalidator = useRevalidator();

  // —— 批量生成 ——
  const activePkgs = packages.filter((p) => p.active);
  const [genPkgId, setGenPkgId] = useState<string>(activePkgs[0]?.id ?? "");
  const [genCount, setGenCount] = useState<number>(100);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<{ batchId: string; count: number } | null>(null);

  async function onGenerate() {
    if (!genPkgId) {
      setGenErr("请先选择套餐");
      return;
    }
    setGenBusy(true);
    setGenErr(null);
    setGenResult(null);
    try {
      const res = await apiPost<{ batchId: string; count: number }>("/api/admin/codes", {
        op: "generate",
        packageId: genPkgId,
        count: genCount,
      });
      setGenResult(res);
      revalidator.revalidate();
    } catch (e) {
      setGenErr(e instanceof ApiError ? e.message : "生成失败，请重试");
    } finally {
      setGenBusy(false);
    }
  }

  // —— 查单 ——
  const [lookupCode, setLookupCode] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<CodeStatus | null>(null);

  async function onLookup() {
    const code = lookupCode.trim();
    if (!code) {
      setLookupErr("请输入兑换码");
      return;
    }
    setLookupBusy(true);
    setLookupErr(null);
    setLookupResult(null);
    try {
      const res = await apiGet<CodeStatus>(`/api/admin/codes/${encodeURIComponent(code)}`);
      setLookupResult(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLookupErr("未找到该兑换码");
      } else {
        setLookupErr(e instanceof ApiError ? e.message : "查询失败，请重试");
      }
    } finally {
      setLookupBusy(false);
    }
  }

  // —— 对账（inline 卡片） ——
  const [reconBatchId, setReconBatchId] = useState<string | null>(null);
  const [reconData, setReconData] = useState<Reconcile | null>(null);
  const [reconBusy, setReconBusy] = useState(false);
  const [reconErr, setReconErr] = useState<string | null>(null);

  async function onReconcile(batchId: string) {
    setReconBatchId(batchId);
    setReconData(null);
    setReconErr(null);
    setReconBusy(true);
    try {
      const res = await apiGet<Reconcile>(`/api/admin/codes/batch/${batchId}`);
      setReconData(res);
    } catch (e) {
      setReconErr(e instanceof ApiError ? e.message : "对账失败，请重试");
    } finally {
      setReconBusy(false);
    }
  }

  // —— 作废批次（confirm） ——
  const [disableTarget, setDisableTarget] = useState<Batch | null>(null);
  const [disableBusy, setDisableBusy] = useState(false);

  async function onConfirmDisable() {
    if (!disableTarget) return;
    setDisableBusy(true);
    try {
      await apiPost<{ disabled: number }>("/api/admin/codes", {
        op: "disable_batch",
        batchId: disableTarget.batchId,
      });
      setDisableTarget(null);
      revalidator.revalidate();
    } catch (e) {
      // 失败保留弹窗，复用 lookupErr 区域不合适；这里直接落回顶部对账错误位无意义，简单 alert 文案。
      setReconErr(e instanceof ApiError ? e.message : "作废失败，请重试");
      setDisableTarget(null);
    } finally {
      setDisableBusy(false);
    }
  }

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>兑换码</h1>
      </div>

      {/* 批量生成 */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>批量生成</div>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gen-pkg">
              套餐
            </label>
            <select
              id="gen-pkg"
              className={styles.select}
              value={genPkgId}
              onChange={(e) => setGenPkgId(e.target.value)}
            >
              {activePkgs.length === 0 ? <option value="">无可用套餐</option> : null}
              {activePkgs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · ¥{formatCash(p.priceCash)} / {formatCredits(p.creditsMp)}积分 ·{" "}
                  {formatValidDays(p.validDays)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gen-count">
              数量（1–5000）
            </label>
            <input
              id="gen-count"
              className={styles.input}
              type="number"
              min={1}
              max={5000}
              value={genCount}
              onChange={(e) => setGenCount(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onGenerate}
            disabled={genBusy || activePkgs.length === 0}
          >
            <Ticket size={15} />
            {genBusy ? "生成中…" : "生成"}
          </button>
        </div>
        {genErr ? <div className={`${styles.formMsg} ${styles.formErr}`}>{genErr}</div> : null}
        {genResult ? (
          <div className={`${styles.formMsg} ${styles.formOk}`}>
            已生成 {genResult.count} 个 · 批次 <span className={styles.mono}>{genResult.batchId.slice(0, 8)}</span>{" "}
            <a className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} href={`/api/admin/codes/export?batchId=${genResult.batchId}`}>
              <Download size={14} />
              下载 CSV
            </a>
          </div>
        ) : null}
      </div>

      {/* 查单 */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>查单</div>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={15} />
            <input
              className={styles.input}
              type="text"
              placeholder="输入兑换码"
              value={lookupCode}
              onChange={(e) => setLookupCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onLookup();
              }}
            />
          </div>
          <button type="button" className={styles.btn} onClick={onLookup} disabled={lookupBusy}>
            {lookupBusy ? "查询中…" : "查询"}
          </button>
        </div>
        {lookupErr ? <div className={`${styles.formMsg} ${styles.formErr}`}>{lookupErr}</div> : null}
        {lookupResult ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                <tr className={styles.tr}>
                  <th className={styles.th}>兑换码</th>
                  <td className={`${styles.td} ${styles.mono}`}>{lookupResult.code}</td>
                </tr>
                <tr className={styles.tr}>
                  <th className={styles.th}>状态</th>
                  <td className={styles.td}>
                    <span className={`${styles.badge} ${statusBadge(lookupResult.status).cls}`}>
                      {statusBadge(lookupResult.status).label}
                    </span>
                  </td>
                </tr>
                <tr className={styles.tr}>
                  <th className={styles.th}>面值</th>
                  <td className={styles.td}>
                    ¥{formatCash(lookupResult.cashValue)} / {formatCredits(lookupResult.creditsValueMp)}积分 ·{" "}
                    {formatValidDays(lookupResult.validDays)}
                  </td>
                </tr>
                <tr className={styles.tr}>
                  <th className={styles.th}>批次</th>
                  <td className={`${styles.td} ${styles.mono}`}>
                    {lookupResult.batchId ? lookupResult.batchId.slice(0, 8) : <span className={styles.muted}>—</span>}
                  </td>
                </tr>
                <tr className={styles.tr}>
                  <th className={styles.th}>兑换人</th>
                  <td className={styles.td}>
                    {lookupResult.redeemedByEmail ? (
                      <>
                        {lookupResult.redeemedByEmail}
                        {lookupResult.redeemedAt ? (
                          <span className={styles.muted}> · {new Date(lookupResult.redeemedAt).toLocaleString("zh-CN")}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.muted}>未兑换</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* 对账结果 inline 卡片 */}
      {reconBatchId ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>
            对账 · 批次 <span className={styles.mono}>{reconBatchId.slice(0, 8)}</span>
          </div>
          {reconBusy ? (
            <div className={styles.muted}>对账中…</div>
          ) : reconErr ? (
            <div className={`${styles.formMsg} ${styles.formErr}`}>{reconErr}</div>
          ) : reconData ? (
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <div className={styles.statNum}>{reconData.issued}</div>
                <div className={styles.statLabel}>已发行</div>
                <div className={styles.statSub}>面值合计 ¥{formatCash(Number(reconData.issuedCash))}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNum}>{reconData.used}</div>
                <div className={styles.statLabel}>已兑换</div>
                <div className={styles.statSub}>收入 ¥{formatCash(Number(reconData.revenueCash))}</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNum}>{reconData.unused}</div>
                <div className={styles.statLabel}>未使用</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNum}>{reconData.disabled}</div>
                <div className={styles.statLabel}>已作废</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 批次列表 */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>批次列表</div>
        {batches.items.length === 0 ? (
          <div className={styles.empty}>暂无批次，先在上方批量生成。</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tr}>
                  <th className={styles.th}>批次</th>
                  <th className={styles.th}>套餐</th>
                  <th className={styles.th}>数量</th>
                  <th className={styles.th}>生成时间</th>
                  <th className={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.items.map((b) => (
                  <tr key={b.batchId} className={styles.tr}>
                    <td className={`${styles.td} ${styles.mono}`}>{b.batchId.slice(0, 8)}</td>
                    <td className={styles.td}>
                      {b.packageTitle ?? <span className={styles.muted}>—</span>}
                    </td>
                    <td className={styles.td}>{b.total}</td>
                    <td className={styles.td}>{new Date(b.createdAt).toLocaleString("zh-CN")}</td>
                    <td className={styles.td}>
                      <div className={styles.rowActions}>
                        <a
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                          href={`/api/admin/codes/export?batchId=${b.batchId}`}
                        >
                          <Download size={14} />
                          导出 CSV
                        </a>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm}`}
                          onClick={() => onReconcile(b.batchId)}
                        >
                          <RefreshCw size={14} />
                          对账
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                          onClick={() => setDisableTarget(b)}
                        >
                          作废
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={disableTarget !== null}
        title="作废整批兑换码"
        message={
          disableTarget
            ? `批次 ${disableTarget.batchId.slice(0, 8)}（共 ${disableTarget.total} 个）中所有未使用的码将被作废，已兑换的不受影响。此操作不可撤销。`
            : undefined
        }
        confirmLabel="作废"
        danger
        busy={disableBusy}
        onConfirm={onConfirmDisable}
        onCancel={() => setDisableTarget(null)}
      />
    </>
  );
}
