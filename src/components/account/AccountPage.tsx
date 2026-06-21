import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatCredits } from "../../lib/format";
import { useMock } from "../../mocks/store";
import { useShell } from "../shell/ShellContext";
import { TopBar } from "../shell/TopBar";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Account.module.css";

export function AccountPage() {
  const mock = useMock();
  const toast = useToast();
  const shell = useShell();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });

  const savePw = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 6) return toast.error("密码至少 6 位");
    if (pw.next !== pw.confirm) return toast.error("两次输入的新密码不一致");
    setPw({ current: "", next: "", confirm: "" });
    toast.success("密码已更新（mock）");
  };

  return (
    <>
      <TopBar title="账号设置" onOpenMenu={shell.openMenu} />
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.section}>
            <h2 className={styles.h}>账号信息</h2>
            <div className={styles.field}>
              <span className={styles.label}>邮箱</span>
              <input className={`${styles.input} ${styles.inputReadonly}`} value={mock.user.email} readOnly />
              <p className={styles.note}>邮箱不可修改</p>
            </div>
          </div>

          <form className={styles.section} onSubmit={savePw}>
            <h2 className={styles.h}>修改密码</h2>
            <div className={styles.field}>
              <span className={styles.label}>当前密码</span>
              <input
                type="password"
                className={styles.input}
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>新密码</span>
              <input
                type="password"
                className={styles.input}
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
                autoComplete="new-password"
              />
              <p className={styles.note}>密码至少 6 位</p>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>确认新密码</span>
              <input
                type="password"
                className={styles.input}
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className={styles.save}>
              保存新密码
            </button>
          </form>

          <div className={styles.section}>
            <h2 className={styles.h}>其他</h2>
            <div className={styles.field}>
              <Link to="/billing" className={styles.row} style={{ textDecoration: "none" }}>
                <span className={styles.label} style={{ margin: 0 }}>
                  当前积分 {formatCredits(mock.balanceMp)} · 去充值
                </span>
                <ChevronRight size={16} color="var(--text-tertiary)" />
              </Link>
            </div>
            <div className={styles.field}>
              <button type="button" className={styles.danger} onClick={() => navigate("/login")}>
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
