import { Mail } from "lucide-react";
import { Link } from "react-router";
import styles from "../../src/components/auth/Auth.module.css";

// 忘记密码本期占位：无邮件基建，提示联系站长重置（规格 §24.1）。
export default function Forgot() {
  return (
    <div className={styles.card}>
      <h1 className={styles.title}>忘记密码</h1>
      <p className={styles.lead}>本期暂未开放邮箱自助重置。如需重置密码，请联系站长协助处理。</p>
      <div className={styles.infoBox}>
        <Mail size={16} />
        站长邮箱：admin@aiworkshop.test
      </div>
      <Link to="/login" className={styles.submit} style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>
        返回登录
      </Link>
    </div>
  );
}
