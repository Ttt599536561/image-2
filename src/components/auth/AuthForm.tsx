import { AlertTriangle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../../lib/auth-client";
import styles from "./Auth.module.css";

// ⑤ 接真：login/register 走 Better Auth client（autoSignIn → 注册即登录）。
// ?next= 回跳受保护页（_app 父 loader 重定向时带上）。错误按 status/code 映射中文文案（§24-1）。
type AuthError = { status?: number; code?: string; message?: string };

function mapSignInError(err: AuthError): string {
  if (err.status === 403) return "账号已被封禁，请联系站长";
  if (err.status === 429) return "尝试过多，请稍后再试";
  if (err.status === 401 || err.code === "INVALID_EMAIL_OR_PASSWORD") return "邮箱或密码错误";
  return err.message || "登录失败，请重试";
}

function mapSignUpError(err: AuthError): string {
  if (err.status === 429) return "尝试过多，请稍后再试";
  return err.message || "注册失败，请重试";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showLoginLink, setShowLoginLink] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setShowLoginLink(false);
    const mail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setError("请输入有效邮箱");
    if (password.length < 6) return setError("密码至少 6 位");
    if (new TextEncoder().encode(password).length > 72) return setError("密码过长（最多 72 字节）");
    if (mode === "register" && confirm !== password) return setError("两次输入的密码不一致");

    setPending(true);
    if (mode === "login") {
      const { error: err } = await authClient.signIn.email({ email: mail, password });
      setPending(false);
      if (err) return setError(mapSignInError(err));
      navigate(next);
    } else {
      const { error: err } = await authClient.signUp.email({ email: mail, password, name: mail });
      setPending(false);
      if (err) {
        if (err.status === 409 || err.code === "USER_ALREADY_EXISTS") {
          setShowLoginLink(true);
          return setError("该邮箱已注册，请直接登录");
        }
        return setError(mapSignUpError(err));
      }
      navigate(next); // autoSignIn → 已登录，进主页/回跳
    }
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
          required
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

      <button type="submit" className={styles.submit} disabled={pending}>
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
