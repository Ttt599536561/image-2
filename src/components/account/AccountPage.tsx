import { Lock, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useLedger, useLots, useMe, useRedemptions } from "../../hooks/queries";
import { authClient } from "../../lib/auth-client";
import { formatCash, formatCredits, formatMonthDay } from "../../lib/format";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import styles from "./Account.module.css";

// 来源 / 流水类型 → 中文（映射我们的模型：FIFO 批次 + 6 类流水，去竞品订阅/月额度概念）。
const SOURCE_LABEL: Record<string, string> = {
  signup: "注册赠送",
  code: "兑换充值",
  adjust: "管理员调整",
};
const ENTRY_LABEL: Record<string, string> = {
  grant: "赠送",
  credit: "充值",
  debit: "消耗",
  refund: "退款",
  expire: "过期",
  adjust: "调整",
};
const LEDGER_TABS: [string, string][] = [
  ["all", "全部"],
  ["credit", "充值"],
  ["debit", "消耗"],
  ["grant", "赠送"],
  ["refund", "退款"],
  ["expire", "过期"],
  ["adjust", "调整"],
];

// adjust 的方向编码在 reason 前缀（"+ …" / "- …"，见 money/adjust.server）；其余按类型定向。
function ledgerSign(entryType: string, reason: string | null): 1 | -1 {
  if (entryType === "debit" || entryType === "expire") return -1;
  if (entryType === "adjust") return (reason ?? "").trimStart().startsWith("-") ? -1 : 1;
  return 1;
}

function expiryText(expiresAt: string | null): string {
  return expiresAt ? expiresAt.slice(0, 10) : "永久";
}

export function AccountPage() {
  const me = useMe();
  const shell = useShell();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pending, setPending] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ledgerType, setLedgerType] = useState("all");

  const lots = useLots();
  const ledger = useLedger(ledgerType);
  const redemptions = useRedemptions();

  const user = me.data?.user;
  const balanceMp = me.data?.balanceMp ?? 0;
  const expMp = Number(me.data?.expiringSoon.mp ?? "0");
  const nearestExp = me.data?.expiringSoon.nearestExpiresAt ?? null;

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (!pw.current) return setPwMsg({ ok: false, text: "请输入当前密码" });
    if (pw.next.length < 6) return setPwMsg({ ok: false, text: "密码至少 6 位" });
    if (new TextEncoder().encode(pw.next).length > 72)
      return setPwMsg({ ok: false, text: "密码过长（最多 72 字节）" });
    if (pw.next !== pw.confirm) return setPwMsg({ ok: false, text: "两次输入的新密码不一致" });
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: pw.current,
      newPassword: pw.next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) return setPwMsg({ ok: false, text: error.message ?? "修改失败，请检查当前密码" });
    setPw({ current: "", next: "", confirm: "" });
    setPwMsg({ ok: true, text: "密码已更新" });
  };

  const logout = async () => {
    await authClient.signOut();
    navigate("/login");
  };

  return (
    <>
      <TopBar title="账号" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          {/* —— 积分余额置顶 —— */}
          <div className={styles.balanceCard}>
            <div className={styles.balanceHead}>
              <Wallet size={16} />
              积分余额
            </div>
            <div className={styles.balanceRow}>
              <span className={styles.balanceNum}>{formatCredits(balanceMp)}</span>
              <span className={styles.balanceUnit}>积分</span>
              <Link to="/billing" className={styles.balanceCta}>
                去充值
              </Link>
            </div>
            {expMp > 0 && nearestExp ? (
              <p className={styles.expiringNote}>
                其中 {formatCredits(expMp)} 积分将于 {formatMonthDay(nearestExp)} 前过期，请尽快使用
              </p>
            ) : null}
          </div>

          {/* —— 积分批次（含有效期）—— */}
          <section className={styles.section}>
            <h2 className={styles.h}>积分批次（最早过期先扣）</h2>
            {lots.isLoading ? (
              <p className={styles.loadingText}>加载中…</p>
            ) : !lots.data || lots.data.items.length === 0 ? (
              <p className={styles.emptyText}>暂无积分批次</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>来源</th>
                      <th className={styles.th}>发放</th>
                      <th className={styles.th}>剩余</th>
                      <th className={styles.th}>到期</th>
                      <th className={styles.th}>获得时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.data.items.map((l) => (
                      <tr key={l.id}>
                        <td className={styles.td}>
                          <span className={styles.sourcePill}>{SOURCE_LABEL[l.source] ?? l.source}</span>
                        </td>
                        <td className={styles.td}>{formatCredits(l.grantedMp)}</td>
                        <td className={styles.td}>{formatCredits(l.remainingMp)}</td>
                        <td className={styles.td}>{expiryText(l.expiresAt)}</td>
                        <td className={styles.tdMuted}>{l.createdAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* —— 积分流水（按类型筛）—— */}
          <section className={styles.section}>
            <h2 className={styles.h}>积分流水</h2>
            <div className={styles.tabs}>
              {LEDGER_TABS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.tab} ${ledgerType === val ? styles.tabActive : ""}`}
                  onClick={() => setLedgerType(val)}
                >
                  {label}
                </button>
              ))}
            </div>
            {ledger.isLoading ? (
              <p className={styles.loadingText}>加载中…</p>
            ) : !ledger.data || ledger.data.items.length === 0 ? (
              <p className={styles.emptyText}>暂无流水</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>类型</th>
                      <th className={styles.th}>变动</th>
                      <th className={styles.th}>变动后</th>
                      <th className={styles.th}>说明</th>
                      <th className={styles.th}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data.items.map((it) => {
                      const sign = ledgerSign(it.entryType, it.reason);
                      return (
                        <tr key={it.id}>
                          <td className={styles.td}>{ENTRY_LABEL[it.entryType] ?? it.entryType}</td>
                          <td className={`${styles.td} ${sign > 0 ? styles.amtPos : styles.amtNeg}`}>
                            {sign > 0 ? "+" : "−"}
                            {formatCredits(it.amountMp)}
                          </td>
                          <td className={styles.tdMuted}>{formatCredits(it.balanceAfterMp)}</td>
                          <td className={styles.tdMuted}>{it.reason ?? "—"}</td>
                          <td className={styles.tdMuted}>
                            {new Date(it.createdAt).toLocaleString("zh-CN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* —— 兑换记录 —— */}
          <section className={styles.section}>
            <h2 className={styles.h}>兑换记录</h2>
            {redemptions.isLoading ? (
              <p className={styles.loadingText}>加载中…</p>
            ) : !redemptions.data || redemptions.data.items.length === 0 ? (
              <p className={styles.emptyText}>还没有兑换记录</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>兑换码</th>
                      <th className={styles.th}>到账积分</th>
                      <th className={styles.th}>面值</th>
                      <th className={styles.th}>有效期</th>
                      <th className={styles.th}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.data.items.map((r) => (
                      <tr key={r.id}>
                        <td className={`${styles.td} ${styles.mono}`}>{r.code ?? "—"}</td>
                        <td className={styles.td}>{formatCredits(r.amountMp)}</td>
                        <td className={styles.tdMuted}>
                          {r.cashValue != null ? `¥${formatCash(r.cashValue)}` : "—"}
                        </td>
                        <td className={styles.tdMuted}>
                          {r.validDays == null ? "永久" : `${r.validDays} 天`}
                        </td>
                        <td className={styles.tdMuted}>{r.createdAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* —— 账号信息（只读）—— */}
          <div className={styles.section}>
            <h2 className={styles.h}>
              账号信息
              <span className={styles.readonlyTag}>
                <Lock size={11} /> 仅展示
              </span>
            </h2>
            <dl className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <dt className={styles.infoLabel}>邮箱</dt>
                <dd className={styles.infoValue}>{user?.email ?? ""}</dd>
              </div>
              <div className={styles.infoItem}>
                <dt className={styles.infoLabel}>注册时间</dt>
                <dd className={styles.infoValue}>{user?.createdAt?.slice(0, 10) ?? ""}</dd>
              </div>
              <div className={styles.infoItem}>
                <dt className={styles.infoLabel}>并发上限</dt>
                <dd className={styles.infoValue}>{me.data?.maxConcurrency ?? ""}</dd>
              </div>
            </dl>
          </div>

          {/* —— 修改密码 —— */}
          <form className={styles.section} onSubmit={savePw}>
            <h2 className={styles.h}>修改密码</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="pw-current">
                当前密码
              </label>
              <input
                id="pw-current"
                type="password"
                className={styles.input}
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
            </div>
            <div className={styles.pwGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pw-next">
                  新密码
                </label>
                <input
                  id="pw-next"
                  type="password"
                  className={styles.input}
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  autoComplete="new-password"
                />
                <p className={styles.note}>密码至少 6 位</p>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pw-confirm">
                  确认新密码
                </label>
                <input
                  id="pw-confirm"
                  type="password"
                  className={styles.input}
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>
            {pwMsg ? (
              <p className={pwMsg.ok ? styles.formOk : styles.formError}>{pwMsg.text}</p>
            ) : null}
            <button type="submit" className={styles.save} disabled={pending}>
              保存新密码
            </button>
          </form>

          {/* —— 账号操作 —— */}
          <div className={styles.section}>
            <h2 className={styles.h}>账号操作</h2>
            <button type="button" className={styles.danger} onClick={logout}>
              退出登录
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
