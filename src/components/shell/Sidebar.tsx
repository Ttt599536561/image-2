import { Image as ImageIcon, Lightbulb, Plus, Search, Sparkles, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConversationDeleteResponse } from "../../contracts/conversation";
import { useConversations, useMe } from "../../hooks/queries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiDelete } from "../../lib/api-client";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Sidebar.module.css";

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const me = useMe();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250); // P3-S2 标题搜索防抖
  const searching = debouncedQuery.length > 0;
  const conversations = useConversations(debouncedQuery).data?.items ?? [];
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();

  // #3 删除会话二次确认
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/conversations/${id}`, undefined, ConversationDeleteResponse),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.removeQueries({ queryKey: ["conversation", id] });
      // 若正看着被删会话，回到新建态
      if (location.pathname === `/c/${id}`) navigate("/");
      setPendingDelete(null);
      toast.success("会话已删除");
    },
    onError: () => {
      setPendingDelete(null);
      toast.error("删除失败，请重试");
    },
  });

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

        <div className={styles.search}>
          <Search size={16} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="搜索对话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索对话"
          />
        </div>

        <div className={styles.recentLabel}>{searching ? "搜索结果" : "最近"}</div>
        {conversations.length === 0 ? (
          <div className={styles.recentEmpty}>
            {searching ? "未找到匹配的对话" : "还没有对话，点「新建生成」开始吧"}
          </div>
        ) : (
          conversations.map((c) => (
            <div key={c.id} className={styles.recentRow}>
              <NavLink
                to={`/c/${c.id}`}
                onClick={onClose}
                className={({ isActive }) =>
                  `${styles.recentItem} ${isActive ? styles.recentActive : ""}`
                }
                title={c.title}
              >
                {c.title || "未命名对话"}
              </NavLink>
              <button
                type="button"
                className={styles.recentDelete}
                aria-label={`删除会话：${c.title || "未命名对话"}`}
                title="删除会话"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPendingDelete({ id: c.id, title: c.title || "未命名对话" });
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="删除该会话？"
        message={
          pendingDelete
            ? `「${pendingDelete.title}」及其全部生成图将被永久删除，不可恢复。`
            : undefined
        }
        confirmLabel="删除"
        busy={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
