import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import styles from "../../src/components/admin/Admin.module.css";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { creditsToMp, formatCash, formatCredits } from "../../src/lib/format";
import { listAudit } from "../../src/server/admin/audit.server";
import { getAllConfig } from "../../src/server/admin/config.server";
import { listAllPackages } from "../../src/server/admin/packages.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.packages";

// 后台「套餐 / 全局参数 / 操作审计」（09 §10.6）。三段卡片：套餐 CRUD（软删）、参数即时改、审计只读。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const [packages, config, audit] = await Promise.all([
    listAllPackages(),
    getAllConfig(),
    listAudit({ pageSize: 50 }),
  ]);
  return { packages, config, audit };
}

// —— 类型（loader 直出，JSON 安全）——
type PackageRow = Route.ComponentProps["loaderData"]["packages"]["items"][number];
type ConfigRow = Route.ComponentProps["loaderData"]["config"]["items"][number];
type AuditRow = Route.ComponentProps["loaderData"]["audit"]["items"][number];

// 参数键中文标签（09 §10.6）。#11：积分类键以「积分」为单位展示/录入（后端仍存 mp）。
const CONFIG_LABELS: Record<string, string> = {
  price_per_image_mp: "单价（积分/张）",
  signup_grant_mp: "注册赠送（积分）",
  signup_grant_valid_days: "赠送有效期（天）",
  retention_free_days: "免费保留（天）",
  retention_paid_days: "付费保留（天）",
  default_max_concurrency: "默认并发",
  daily_relay_budget_calls: "单日预算（次）",
  daily_relay_budget_ms: "单日预算（ms）",
};

// #11：哪些参数键是毫积分（UI 填积分、提交 ×1000）。其余键为普通整数，原样。
const MP_CONFIG_KEYS = new Set<string>(["price_per_image_mp", "signup_grant_mp"]);
/** 后端 mp 值 → 录入框展示值（mp 键转积分小数，其余整数原样）。 */
function cfgToDisplay(key: string, value: number): string {
  return MP_CONFIG_KEYS.has(key) ? formatCredits(value) : String(value);
}
/** 录入框值 → 后端 mp 值（mp 键 ×1000 取整，其余整数截断）。 */
function cfgToMp(key: string, str: string): number {
  return MP_CONFIG_KEYS.has(key) ? creditsToMp(Number(str)) : Math.trunc(Number(str));
}

// 套餐表单的可编辑形态（字符串态，提交时再换算/解析）。
interface PackageForm {
  title: string;
  description: string;
  priceYuan: string; // 元；提交时 ×100 → priceCash 整数（分）
  credits: string; // 积分；提交时 ×1000 → creditsMp 整数
  validDays: string; // 空=永久→null
  redirectUrl: string;
  sort: string;
  active: boolean;
}

const EMPTY_FORM: PackageForm = {
  title: "",
  description: "",
  priceYuan: "",
  credits: "",
  validDays: "",
  redirectUrl: "",
  sort: "0",
  active: true,
};

function toForm(p: PackageRow): PackageForm {
  return {
    title: p.title,
    description: p.description ?? "",
    priceYuan: String(p.priceCash / 100),
    credits: String(p.creditsMp / 1000),
    validDays: p.validDays == null ? "" : String(p.validDays),
    redirectUrl: p.redirectUrl ?? "",
    sort: String(p.sort),
    active: p.active,
  };
}

export default function PackagesPage({ loaderData }: Route.ComponentProps) {
  const { packages, config, audit } = loaderData;
  const revalidator = useRevalidator();

  // ===== section 1 套餐 =====
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null=新增
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [pkgErr, setPkgErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PackageRow | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPkgErr(null);
    setEditorOpen(true);
  };
  const openEdit = (p: PackageRow) => {
    setEditingId(p.id);
    setForm(toForm(p));
    setPkgErr(null);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    if (pkgBusy) return;
    setEditorOpen(false);
  };

  const submitPackage = async () => {
    setPkgBusy(true);
    setPkgErr(null);
    const validDays = form.validDays.trim() === "" ? null : Math.trunc(Number(form.validDays));
    const fields = {
      title: form.title.trim(),
      description: form.description.trim() === "" ? null : form.description.trim(),
      priceCash: Math.round(Number(form.priceYuan) * 100),
      creditsMp: Math.round(Number(form.credits) * 1000),
      validDays,
      redirectUrl: form.redirectUrl.trim() === "" ? null : form.redirectUrl.trim(),
      sort: form.sort.trim() === "" ? 0 : Math.trunc(Number(form.sort)),
      active: form.active,
    };
    try {
      if (editingId) {
        await apiPost("/api/admin/packages", { op: "update", id: editingId, ...fields });
      } else {
        await apiPost("/api/admin/packages", { op: "create", ...fields });
      }
      setEditorOpen(false);
      revalidator.revalidate();
    } catch (e) {
      setPkgErr(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setPkgBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setPkgBusy(true);
    setPkgErr(null);
    try {
      await apiPost("/api/admin/packages", { op: "delete", id: deleteTarget.id });
      setDeleteTarget(null);
      revalidator.revalidate();
    } catch (e) {
      setPkgErr(e instanceof ApiError ? e.message : "软删失败，请重试");
    } finally {
      setPkgBusy(false);
    }
  };

  // ===== section 2 全局参数 =====
  const initialConfig = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of config.items as ConfigRow[]) m[c.key] = cfgToDisplay(c.key, c.value);
    return m;
  }, [config.items]);
  const [cfgValues, setCfgValues] = useState<Record<string, string>>(initialConfig);
  const [cfgConfirmOpen, setCfgConfirmOpen] = useState(false);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 与 loader 对比，找出被改动的键（按展示值比较）。
  const changedKeys = useMemo(
    () => (config.items as ConfigRow[]).filter((c) => cfgValues[c.key] !== cfgToDisplay(c.key, c.value)),
    [config.items, cfgValues],
  );

  const saveConfig = async () => {
    setCfgBusy(true);
    setCfgMsg(null);
    const updates = changedKeys.map((c) => ({ key: c.key, value: cfgToMp(c.key, cfgValues[c.key]) }));
    try {
      await apiPost("/api/admin/config", { updates });
      setCfgConfirmOpen(false);
      setCfgMsg({ ok: true, text: `已保存 ${updates.length} 项参数` });
      revalidator.revalidate();
    } catch (e) {
      setCfgConfirmOpen(false);
      setCfgMsg({ ok: false, text: e instanceof ApiError ? e.message : "保存失败，请重试" });
    } finally {
      setCfgBusy(false);
    }
  };

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>套餐 / 参数</h1>
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openCreate}>
            <Plus size={15} />
            新增套餐
          </button>
        </div>
      </div>

      {/* —— section 1：充值套餐 —— */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>充值套餐</h2>
        {pkgErr ? <p className={`${styles.formMsg} ${styles.formErr}`}>{pkgErr}</p> : null}
        {packages.items.length === 0 ? (
          <div className={styles.empty}>暂无套餐，点击「新增套餐」创建</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>标题</th>
                  <th className={styles.th}>价格</th>
                  <th className={styles.th}>积分</th>
                  <th className={styles.th}>有效期</th>
                  <th className={styles.th}>已发码</th>
                  <th className={styles.th}>状态</th>
                  <th className={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {(packages.items as PackageRow[]).map((p) => (
                  <tr key={p.id} className={styles.tr}>
                    <td className={styles.td}>{p.title}</td>
                    <td className={styles.td}>¥{formatCash(p.priceCash)}</td>
                    <td className={styles.td}>{formatCredits(p.creditsMp)}</td>
                    <td className={styles.td}>{p.validDays == null ? "永久" : `${p.validDays}天`}</td>
                    <td className={styles.td}>{p.codeCount}</td>
                    <td className={styles.td}>
                      {p.active ? (
                        <span className={`${styles.badge} ${styles.badgeOk}`}>上架</span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>下架</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil size={13} />
                          编辑
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 size={13} />
                          软删
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

      {/* —— section 2：全局参数 —— */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>全局参数</h2>
        <div className={styles.formGrid}>
          {(config.items as ConfigRow[]).map((c) => (
            <div key={c.key} className={styles.field}>
              <label className={styles.label} htmlFor={`cfg-${c.key}`}>
                {CONFIG_LABELS[c.key] ?? c.key}
              </label>
              <input
                id={`cfg-${c.key}`}
                className={styles.input}
                type="number"
                min={MP_CONFIG_KEYS.has(c.key) ? "0" : "1"}
                step={MP_CONFIG_KEYS.has(c.key) ? "0.001" : "1"}
                value={cfgValues[c.key] ?? ""}
                onChange={(e) => setCfgValues((prev) => ({ ...prev, [c.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {cfgMsg ? (
          <p className={`${styles.formMsg} ${cfgMsg.ok ? styles.formOk : styles.formErr}`}>{cfgMsg.text}</p>
        ) : null}
        <div className={styles.toolbar} style={{ marginTop: "var(--space-3)" }}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={changedKeys.length === 0}
            onClick={() => {
              setCfgMsg(null);
              setCfgConfirmOpen(true);
            }}
          >
            保存{changedKeys.length > 0 ? `（${changedKeys.length} 项改动）` : ""}
          </button>
        </div>
      </div>

      {/* —— section 3：操作审计 —— */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>操作审计</h2>
        <p className={`${styles.muted}`} style={{ fontSize: 12, margin: "0 0 var(--space-4)" }}>
          只追加、不可删改
        </p>
        {audit.items.length === 0 ? (
          <div className={styles.empty}>暂无审计记录</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>时间</th>
                  <th className={styles.th}>管理员</th>
                  <th className={styles.th}>动作</th>
                  <th className={styles.th}>对象</th>
                  <th className={styles.th}>原因</th>
                </tr>
              </thead>
              <tbody>
                {(audit.items as AuditRow[]).map((a) => (
                  <tr key={a.id} className={styles.tr}>
                    <td className={styles.td}>{new Date(a.createdAt).toLocaleString("zh-CN")}</td>
                    <td className={styles.td}>{a.adminEmail ?? <span className={styles.muted}>—</span>}</td>
                    <td className={styles.td}>
                      <span className={styles.mono}>{a.action}</span>
                    </td>
                    <td className={styles.td}>
                      {a.targetType ? (
                        <span className={styles.muted}>
                          {a.targetType} {a.targetId ? a.targetId.slice(0, 8) : ""}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.td}>{a.reason ?? <span className={styles.muted}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* —— 套餐新增/编辑 弹窗 —— */}
      {editorOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? "编辑套餐" : "新增套餐"}
          onClick={closeEditor}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--space-4)",
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            className={styles.card}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 100%)", maxHeight: "90dvh", overflowY: "auto", marginBottom: 0 }}
          >
            <h2 className={styles.cardTitle}>{editingId ? "编辑套餐" : "新增套餐"}</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pkg-title">
                标题
              </label>
              <input
                id="pkg-title"
                className={styles.input}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pkg-desc">
                描述
              </label>
              <textarea
                id="pkg-desc"
                className={styles.textarea}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pkg-price">
                  价格（元）
                </label>
                <input
                  id="pkg-price"
                  className={styles.input}
                  type="number"
                  step="0.01"
                  value={form.priceYuan}
                  onChange={(e) => setForm((f) => ({ ...f, priceYuan: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pkg-credits">
                  积分
                </label>
                <input
                  id="pkg-credits"
                  className={styles.input}
                  type="number"
                  step="0.001"
                  value={form.credits}
                  onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pkg-valid">
                  有效期（天，空=永久）
                </label>
                <input
                  id="pkg-valid"
                  className={styles.input}
                  type="number"
                  placeholder="永久"
                  value={form.validDays}
                  onChange={(e) => setForm((f) => ({ ...f, validDays: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pkg-sort">
                  排序
                </label>
                <input
                  id="pkg-sort"
                  className={styles.input}
                  type="number"
                  value={form.sort}
                  onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pkg-url">
                跳转 URL
              </label>
              <input
                id="pkg-url"
                className={styles.input}
                value={form.redirectUrl}
                onChange={(e) => setForm((f) => ({ ...f, redirectUrl: e.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} style={{ flexDirection: "row", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                上架
              </label>
            </div>

            {pkgErr ? <p className={`${styles.formMsg} ${styles.formErr}`}>{pkgErr}</p> : null}

            <div className={styles.toolbar} style={{ marginTop: "var(--space-4)", justifyContent: "flex-end" }}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={closeEditor} disabled={pkgBusy}>
                取消
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={submitPackage}
                disabled={pkgBusy || form.title.trim() === ""}
              >
                {editingId ? "保存" : "创建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* —— 软删确认 —— */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="软删套餐"
        message="软删后该套餐下架，历史兑换码不受影响"
        confirmLabel="软删"
        danger
        busy={pkgBusy}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!pkgBusy) setDeleteTarget(null);
        }}
      />

      {/* —— 保存参数确认（敏感写）—— */}
      <ConfirmDialog
        open={cfgConfirmOpen}
        title="保存全局参数"
        message={`将更新 ${changedKeys.length} 项参数，立即对全站生效。确认保存？`}
        confirmLabel="保存"
        busy={cfgBusy}
        onConfirm={saveConfig}
        onCancel={() => {
          if (!cfgBusy) setCfgConfirmOpen(false);
        }}
      />
    </>
  );
}
