import { Image as ImageIcon, Lightbulb, Plus, Search, Sparkles, User } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { useMock } from "../../mocks/store";
import styles from "./Sidebar.module.css";

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const mock = useMock();
  const navigate = useNavigate();

  const startNew = () => {
    mock.startNewConversation();
    navigate("/");
    onClose?.();
  };

  return (
    <>
      {open ? (
        <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      ) : null}
      <aside className={`${styles.aside} ${open ? styles.asideOpen : ""}`}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Sparkles size={16} />
          </span>
          图像工坊
        </div>

        <button type="button" className={styles.newBtn} onClick={startNew}>
          <Plus size={16} />
          新建生成
        </button>

        <span className={`${styles.nav} ${styles.navDisabled}`} title="搜索（敬请期待）">
          <Search size={16} />
          搜索
        </span>

        <div className={styles.recentLabel}>最近</div>
        {mock.conversations.length === 0 ? (
          <div className={styles.recentEmpty}>还没有对话，点「新建生成」开始吧</div>
        ) : (
          mock.conversations.map((c) => (
            <NavLink
              key={c.id}
              to={`/c/${c.id}`}
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.recentItem} ${isActive ? styles.recentActive : ""}`
              }
              title={c.title}
            >
              {c.title}
            </NavLink>
          ))
        )}

        <div className={styles.spacer} />

        <NavLink
          to="/assets"
          onClick={onClose}
          className={({ isActive }) => `${styles.nav} ${isActive ? styles.navActive : ""}`}
        >
          <ImageIcon size={16} />
          资产库
        </NavLink>
        <NavLink
          to="/inspiration"
          onClick={onClose}
          className={({ isActive }) => `${styles.nav} ${isActive ? styles.navActive : ""}`}
        >
          <Lightbulb size={16} />
          灵感库
        </NavLink>

        <NavLink to="/account" onClick={onClose} className={styles.account}>
          <User size={18} />
          <span className={styles.accountEmail}>{mock.user.email}</span>
        </NavLink>
      </aside>
    </>
  );
}
