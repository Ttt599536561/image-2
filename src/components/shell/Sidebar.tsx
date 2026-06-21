import { Image as ImageIcon, Lightbulb, Plus, Search, Sparkles, User } from "lucide-react";
import { useEffect } from "react";
import { NavLink, useNavigate } from "react-router";
import { useConversations, useMe } from "../../hooks/queries";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import styles from "./Sidebar.module.css";

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const me = useMe();
  const conversations = useConversations().data?.items ?? [];
  const navigate = useNavigate();

  // 移动端抽屉：锁背景滚动 + ESC 关闭
  useLockBodyScroll(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const startNew = () => {
    // 新建生成 = 路由到 "/" 并清空 Composer；首次提交成功后服务端建会话（08 §9.2）。
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
        {conversations.length === 0 ? (
          <div className={styles.recentEmpty}>还没有对话，点「新建生成」开始吧</div>
        ) : (
          conversations.map((c) => (
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
          <span className={styles.accountEmail}>{me.data?.user.email ?? ""}</span>
        </NavLink>
      </aside>
    </>
  );
}
