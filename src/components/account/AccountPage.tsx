import { Lock } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMe } from "../../hooks/queries";
import { authClient } from "../../lib/auth-client";
import { formatCredits } from "../../lib/format";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import styles from "./Account.module.css";

export function AccountPage() {
  const me = useMe();
  const shell = useShell();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pending, setPending] = useState(false);
  // 表单反馈就近内联（不丢到右上角 toast）
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const user = me.data?.user;

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (!pw.current) return setPwMsg({ ok: false, text: "请输入当前密码" });
    if (pw.next.length < 6) return setPwMsg({ ok: false, text: "密码至少 6 位" });
    if (new TextEncoder().encode(pw.next).length > 72)
      return setPwMsg({ ok: false, text: "密码过长（最多 72 字节）" });
    if (pw.next !== pw.confirm) return setPwMsg({ ok: false, text: "两次输入的新密码不一致" });
    setPending(true);
    // 改密走 Better Auth（密码 ≥6、字节限长在 password.hash 内强制断言）；改密后吊销其它会话（05 §6.5）。
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
      <TopBar title="账号设置" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          {/* 账号信息：只读，标签+文本横向铺开（非输入框），一眼可见不可编辑 */}
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
              <div className={styles.infoItem}>
                <dt className={styles.infoLabel}>当前积分</dt>
                <dd className={styles.infoValue}>
                  {formatCredits(me.data?.balanceMp ?? 0)}
                  <Link to="/billing" className={styles.inlineLink}>
                    去充值
                  </Link>
                </dd>
              </div>
            </dl>
          </div>

          {/* 修改密码：可编辑表单 */}
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

          {/* 账号操作 */}
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
