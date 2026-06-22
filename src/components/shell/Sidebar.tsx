import { Image as ImageIcon, Lightbulb, Pencil, Plus, Search, Sparkles, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConversationDeleteResponse, ConversationRenameResponse } from "../../contracts/conversation";
import { useConversations, useMe } from "../../hooks/queries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiDelete, apiPatch } from "../../lib/api-client";
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

  // §10 重命名会话：行内编辑（铅笔进入，Enter 提交 / Esc 取消 / 失焦取消）。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  const renameMutation = useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      apiPatch(`/api/conversations/${v.id}`, { title: v.title }, ConversationRenameResponse),
    onSuccess: (_res, v) => {
      // 列表 + 当前会话详情（TopBar 标题取自详情）同步刷新。
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
      setEditingId(null);
      toast.success("已重命名");
    },
    onError: () => toast.error("重命名失败，请重试"),
  });

  const startRename = (id: string, title: string) => {
    setEditingId(id);
    setEditValue(title);
  };
  const cancelRename = () => setEditingId(null);
  const submitRename = (id: string, current: string) => {
    if (renameMutation.isPending) return; // 防 Enter 长按/连击重复发 PATCH（镜像 delete 的 busy 守卫）
    const title = editValue.trim();
    if (!title) {
      toast.error("标题不能为空"); // 前端拦空标题
      return;
    }
    if (title === current.trim()) {
      setEditingId(null); // 无改动直接退出
      return;
    }
    renameMutation.mutate({ id, title });
  };

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
          conversations.map((c) =>
            editingId === c.id ? (
              <div key={c.id} className={styles.recentRow}>
                <input
                  className={styles.recentEdit}
                  value={editValue}
                  maxLength={200}
                  autoFocus
                  disabled={renameMutation.isPending}
                  aria-label="会话名称"
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitRename(c.id, c.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  // 失焦取消；但保存中（含 disabled 触发的 blur）不取消——避免丢失输入，失败时编辑框留存可重试。
                  onBlur={() => {
                    if (!renameMutation.isPending) cancelRename();
                  }}
                />
              </div>
            ) : (
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
                <div className={styles.recentActions}>
                  <button
                    type="button"
                    className={styles.recentAction}
                    aria-label={`重命名会话：${c.title || "未命名对话"}`}
                    title="重命名"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startRename(c.id, c.title || "");
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.recentAction} ${styles.recentActionDanger}`}
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
              </div>
            ),
          )
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
