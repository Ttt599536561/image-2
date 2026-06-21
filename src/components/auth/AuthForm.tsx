import { AlertTriangle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import styles from "./Auth.module.css";

// 阶段一鉴权为 mock：仅做前端校验 + 跳主页，不接真账号（Better Auth 在阶段二）。
const TAKEN_EMAIL = "taken@example.com";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setShowLoginLink(false);
    if (!email.trim()) return setError("请输入邮箱");
    if (password.length < 6) return setError("密码至少 6 位");
    if (mode === "register") {
      if (email.trim().toLowerCase() === TAKEN_EMAIL) {
        setShowLoginLink(true);
        return setError("该邮箱已注册，请直接登录");
      }
      if (confirm !== password) return setError("两次输入的密码不一致");
    }
    navigate("/"); // mock 登录/注册成功 → 进主页
  };

  return (
    <form className={styles.card} onSubmit={onSubmit}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <Sparkles size={17} />
        </span>
        AI 图像工坊
      </div>

      <div className={styles.tabs}>
        <Link to="/login" className={`${styles.tab} ${mode === "login" ? styles.tabActive : ""}`}>
          登录
        </Link>
        <Link
          to="/register"
          className={`${styles.tab} ${mode === "register" ? styles.tabActive : ""}`}
        >
          注册
        </Link>
      </div>

      {error ? (
        <div className={styles.error}>
          <AlertTriangle size={15} />
          {error}
          {showLoginLink ? (
            <Link to="/login" className={styles.errorLink}>
              去登录
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          邮箱
        </label>
        <input
          id="email"
          type="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          密码
        </label>
        <input
          id="password"
          type="password"
          className={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {mode === "register" ? <p className={styles.note}>密码至少 6 位</p> : null}
      </div>

      {mode === "register" ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm">
            确认密码
          </label>
          <input
            id="confirm"
            type="password"
            className={styles.input}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
      ) : null}

      <button type="submit" className={styles.submit}>
        {mode === "login" ? "登录" : "注册"}
      </button>

      <div className={styles.footer}>
        {mode === "login" ? (
          <Link to="/forgot" className={styles.footerLink}>
            忘记密码?
          </Link>
        ) : (
          <span>注册即送 0.14 积分（2 张）</span>
        )}
      </div>
    </form>
  );
}
