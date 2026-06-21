import { Coins, KeyRound, Search, Shield, ShieldOff, Users as UsersIcon } from "lucide-react";
import { useState } from "react";
import { useRevalidator } from "react-router";
import { ConfirmDialog } from "../../src/components/ConfirmDialog/ConfirmDialog";
import styles from "../../src/components/admin/Admin.module.css";
import { ApiError, apiPost } from "../../src/lib/api-client";
import { formatCredits } from "../../src/lib/format";
import type { AdminUserRow } from "../../src/server/admin/users.server";
import { searchUsers } from "../../src/server/admin/users.server";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin.users";

// 后台用户管理（09 §10.3）：搜索 + 封禁/解封/调积分/调并发/改密。敏感写一律走二次确认。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  const p = new URL(request.url).searchParams;
  const q = p.get("q") ?? undefined;
  const data = await searchUsers(q, Math.max(1, Number(p.get("page") ?? 1) || 1), 50);
  return { data, q: q ?? "" };
}

type ModalKind = "credit" | "concurrency" | "password" | null;

const scrimStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "var(--scrim)",
  zIndex: 80,
  padding: "var(--space-4)",
};
const modalCardStyle: React.CSSProperties = { maxWidth: 360, width: "100%", margin: 0 };

export default function Page({ loaderData }: Route.ComponentProps) {
  const { data, q } = loaderData;
  const revalidator = useRevalidator();

  // 当前操作的用户 + 弹窗类型
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [banConfirm, setBanConfirm] = useState<AdminUserRow | null>(null);
  const [pending, setPending] = useState(false);

  const closeModal = () => {
    setModal(null);
    setTarget(null);
  };

  // 封禁/解封：纯确认 → 复用 ConfirmDialog。
  const confirmBan = async () => {
    if (!banConfirm) return;
    setPending(true);
    try {
      await apiPost(`/api/admin/users/${banConfirm.id}`, {
        op: "ban",
        banned: !banConfirm.isBanned,
      });
      setBanConfirm(null);
      revalidator.revalidate();
    } catch {
      // ConfirmDialog 无内联错误位；失败保留弹窗，用户可重试
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>
          <UsersIcon size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />
          用户管理
        </h1>
        <form method="get" className={styles.toolbar}>
          <input
            type="search"
            name="q"
            className={styles.search}
            defaultValue={q}
            placeholder="按邮箱搜索…"
            aria-label="按邮箱搜索用户"
          />
          <button type="submit" className={styles.btn}>
            <Search size={15} />
            搜索
          </button>
        </form>
      </div>

      {data.items.length === 0 ? (
        <div className={styles.empty}>{q ? `没有匹配「${q}」的用户` : "暂无用户"}</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>邮箱</th>
                <th className={styles.th}>余额</th>
                <th className={styles.th}>并发</th>
                <th className={styles.th}>状态</th>
                <th className={styles.th}>注册</th>
                <th className={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className={styles.tr}>
                  <td className={styles.td}>{u.email}</td>
                  <td className={styles.td}>{formatCredits(u.balanceMp)}</td>
                  <td className={styles.td}>{u.maxConcurrency}</td>
                  <td className={styles.td}>
                    {u.isBanned ? (
                      <span className={`${styles.badge} ${styles.badgeDanger}`}>已封禁</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeOk}`}>正常</span>
                    )}
                    {u.hasPaid ? (
                      <span
                        className={`${styles.badge} ${styles.badgeMuted}`}
                        style={{ marginLeft: 6 }}
                      >
                        付费
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.td}>{u.createdAt.slice(0, 10)}</td>
                  <td className={styles.td}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm} ${u.isBanned ? "" : styles.btnDanger}`}
                        onClick={() => setBanConfirm(u)}
                      >
                        {u.isBanned ? <Shield size={13} /> : <ShieldOff size={13} />}
                        {u.isBanned ? "解封" : "封禁"}
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => {
                          setTarget(u);
                          setModal("credit");
                        }}
                      >
                        <Coins size={13} />
                        调积分
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => {
                          setTarget(u);
                          setModal("concurrency");
                        }}
                      >
                        调并发
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => {
                          setTarget(u);
                          setModal("password");
                        }}
                      >
                        <KeyRound size={13} />
                        改密
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total > data.pageSize ? (
        <p className={styles.muted} style={{ marginTop: "var(--space-3)", fontSize: 12 }}>
          共 {data.total} 个用户，当前第 {data.page} 页（每页 {data.pageSize}）
        </p>
      ) : null}

      {/* 封禁/解封：纯确认 */}
      <ConfirmDialog
        open={banConfirm !== null}
        title={banConfirm?.isBanned ? "解除封禁" : "封禁用户"}
        message={
          banConfirm
            ? banConfirm.isBanned
              ? `确认解封 ${banConfirm.email}？该用户将恢复访问。`
              : `确认封禁 ${banConfirm.email}？该用户将无法登录与生图。`
            : undefined
        }
        confirmLabel={banConfirm?.isBanned ? "解封" : "封禁"}
        danger={!banConfirm?.isBanned}
        busy={pending}
        onConfirm={confirmBan}
        onCancel={() => {
          if (!pending) setBanConfirm(null);
        }}
      />

      {/* 输入型弹窗 */}
      {modal === "credit" && target ? (
        <CreditModal
          user={target}
          onClose={closeModal}
          onDone={() => {
            closeModal();
            revalidator.revalidate();
          }}
        />
      ) : null}
      {modal === "concurrency" && target ? (
        <ConcurrencyModal
          user={target}
          onClose={closeModal}
          onDone={() => {
            closeModal();
            revalidator.revalidate();
          }}
        />
      ) : null}
      {modal === "password" && target ? (
        <PasswordModal
          user={target}
          onClose={closeModal}
          onDone={() => {
            closeModal();
            revalidator.revalidate();
          }}
        />
      ) : null}
    </>
  );
}

// ── 共用：弹窗壳 ───────────────────────────────────────────────
function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={scrimStyle} onClick={onClose} role="presentation">
      <div
        className={styles.card}
        style={modalCardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.cardTitle}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "操作失败，请重试";
}

// ── 调积分 ─────────────────────────────────────────────────────
function CreditModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [deltaMp, setDeltaMp] = useState("");
  const [reason, setReason] = useState("");
  const [permanent, setPermanent] = useState(true);
  const [validDays, setValidDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const delta = Number(deltaMp);
  const valid =
    deltaMp.trim() !== "" &&
    Number.isFinite(delta) &&
    Number.isInteger(delta) &&
    delta !== 0 &&
    reason.trim() !== "" &&
    (permanent || (validDays.trim() !== "" && Number(validDays) > 0));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/api/admin/users/${user.id}`, {
        op: "adjust_credit",
        deltaMp: delta,
        reason: reason.trim(),
        validDays: permanent ? null : Number(validDays),
      });
      onDone();
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`调整积分 · ${user.email}`} onClose={onClose}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="adj-delta">
          调整毫积分（可负）
        </label>
        <input
          id="adj-delta"
          type="number"
          step={1}
          className={styles.input}
          value={deltaMp}
          onChange={(e) => setDeltaMp(e.target.value)}
          placeholder="如 70000（=70 积分），负数为扣减"
        />
        <span className={styles.muted} style={{ fontSize: 11 }}>
          毫积分，1 积分 = 1000；
          {deltaMp.trim() !== "" && Number.isInteger(delta) && delta !== 0
            ? `约 ${formatCredits(Math.abs(delta))} 积分${delta < 0 ? "（扣减）" : ""}`
            : "正数充入、负数扣减"}
        </span>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="adj-reason">
          原因（必填）
        </label>
        <input
          id="adj-reason"
          type="text"
          className={styles.input}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="记入审计与流水"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} style={{ flexDirection: "row", display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
          />
          永久有效（不设过期）
        </label>
      </div>
      {!permanent ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="adj-days">
            有效期（天）
          </label>
          <input
            id="adj-days"
            type="number"
            min={1}
            step={1}
            className={styles.input}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
            placeholder="如 60"
          />
        </div>
      ) : null}
      {err ? (
        <p className={`${styles.formMsg} ${styles.formErr}`}>{err}</p>
      ) : null}
      <div className={styles.rowActions} style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={submit}
          disabled={!valid || busy}
        >
          {busy ? "提交中…" : "确认调整"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── 调并发 ─────────────────────────────────────────────────────
function ConcurrencyModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(String(user.maxConcurrency));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= 1;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/api/admin/users/${user.id}`, {
        op: "set_concurrency",
        maxConcurrency: n,
      });
      onDone();
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell title={`调整并发 · ${user.email}`} onClose={onClose}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="adj-conc">
          最大并发数（≥ 1）
        </label>
        <input
          id="adj-conc"
          type="number"
          min={1}
          step={1}
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <span className={styles.muted} style={{ fontSize: 11 }}>
          当前 {user.maxConcurrency}；超出此数的生图请求将被拒绝。
        </span>
      </div>
      {err ? (
        <p className={`${styles.formMsg} ${styles.formErr}`}>{err}</p>
      ) : null}
      <div className={styles.rowActions} style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={submit}
          disabled={!valid || busy}
        >
          {busy ? "提交中…" : "确认"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── 改密 ───────────────────────────────────────────────────────
function PasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pw, setPw] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = pw.length >= 6;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/api/admin/users/${user.id}`, {
        op: "reset_pw",
        newPassword: pw,
      });
      onDone();
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <ModalShell title={`重置密码 · ${user.email}`} onClose={onClose}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="adj-pw">
            新密码（至少 6 位）
          </label>
          <input
            id="adj-pw"
            type="text"
            autoComplete="new-password"
            className={styles.input}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="管理员设置的新密码"
          />
          <span className={styles.muted} style={{ fontSize: 11 }}>
            重置后该用户现有会话将被吊销。
          </span>
        </div>
        {err ? (
          <p className={`${styles.formMsg} ${styles.formErr}`}>{err}</p>
        ) : null}
        <div className={styles.rowActions} style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setConfirming(true)}
            disabled={!valid || busy}
          >
            重置密码
          </button>
        </div>
      </ModalShell>
      <ConfirmDialog
        open={confirming}
        title="确认重置密码"
        message={`确认将 ${user.email} 的密码重置为新值？此操作会吊销其现有登录会话。`}
        confirmLabel="确认重置"
        danger
        busy={busy}
        onConfirm={submit}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
      />
    </>
  );
}