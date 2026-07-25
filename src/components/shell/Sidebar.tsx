import {
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConversationDeleteResponse, ConversationRenameResponse } from "../../contracts/conversation";
import type { ConversationDetail, ConversationListResponse } from "../../contracts/conversation";
import { ProjectMutationResponse, ProjectOrderResponse } from "../../contracts/project";
import type { ProjectListItem, ProjectListResponse } from "../../contracts/project";
import { useConversations, useMe, useProjects } from "../../hooks/queries";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { apiDelete, apiPatch, apiPost } from "../../lib/api-client";
import { useLockBodyScroll } from "../../lib/useLockBodyScroll";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { ProjectNameDialog } from "../ProjectDialog/ProjectNameDialog";
import { useToast } from "../Toast/ToastProvider";
import styles from "./Sidebar.module.css";

// —— F-074 长按拖动排序（桌面鼠标 / 移动触摸通用，Pointer Events）——
// 未到长按阈值松手 = 普通点击（导航/展开收起）；进入拖动态后吞掉随之而来的 click。
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 8;

type DragTarget =
  | { kind: "project"; projectId: string }
  | { kind: "conversation"; projectId: string; conversationId: string };

type DragState = { target: DragTarget; overIndex: number };

function dragIdOf(target: DragTarget): string {
  return target.kind === "project" ? target.projectId : target.conversationId;
}

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const me = useMe();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250); // P3-S2 标题搜索防抖
  const searching = debouncedQuery.length > 0;
  const conversations = useConversations(debouncedQuery).data?.items ?? [];
  const projects = useProjects().data?.items ?? [];
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const asideRef = useRef<HTMLElement>(null);

  // #3 删除会话二次确认
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  // §10 重命名会话：行内编辑（铅笔进入，Enter 提交 / Esc 取消 / 失焦取消）。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // F-074 项目行「…」下拉、「新建/重命名项目」弹窗
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<
    { mode: "create" } | { mode: "rename"; projectId: string; name: string } | null
  >(null);

  // ⚡ 乐观更新：跨境 mutation 往返 300-800ms，期间侧栏保持旧态是最直观的「慢半拍」。
  // onMutate 先就地改 TanStack Query 缓存（侧栏立即变化），失败时 onError 用快照回滚，onSettled invalidate 兜底对齐。
  // setQueriesData 覆盖所有 ["conversations", *]（含搜索结果态）。
  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/conversations/${id}`, undefined, ConversationDeleteResponse),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      await qc.cancelQueries({ queryKey: ["projects"] });
      const prev = qc.getQueriesData<ConversationListResponse>({ queryKey: ["conversations"] });
      const prevProjects = qc.getQueriesData<ProjectListResponse>({ queryKey: ["projects"] });
      qc.setQueriesData<ConversationListResponse>({ queryKey: ["conversations"] }, (old) =>
        old
          ? { ...old, items: old.items.filter((c) => c.id !== id), total: Math.max(0, old.total - 1) }
          : old,
      );
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((p) => ({
                ...p,
                conversations: p.conversations.filter((c) => c.id !== id),
              })),
            }
          : old,
      );
      return { prev, prevProjects };
    },
    onSuccess: (_res, id) => {
      qc.removeQueries({ queryKey: ["conversation", id] });
      // 若正看着被删会话，回到新建态
      if (location.pathname === `/c/${id}`) navigate("/");
      setPendingDelete(null);
      toast.success("会话已删除");
    },
    onError: (_e, _id, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      for (const [key, data] of ctx?.prevProjects ?? []) qc.setQueryData(key, data);
      setPendingDelete(null);
      toast.error("删除失败，请重试");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      apiPatch(`/api/conversations/${v.id}`, { title: v.title }, ConversationRenameResponse),
    onMutate: async (v: { id: string; title: string }) => {
      await qc.cancelQueries({ queryKey: ["conversations"] });
      await qc.cancelQueries({ queryKey: ["projects"] });
      const prev = qc.getQueriesData<ConversationListResponse>({ queryKey: ["conversations"] });
      const prevProjects = qc.getQueriesData<ProjectListResponse>({ queryKey: ["projects"] });
      qc.setQueriesData<ConversationListResponse>({ queryKey: ["conversations"] }, (old) =>
        old
          ? { ...old, items: old.items.map((c) => (c.id === v.id ? { ...c, title: v.title } : c)) }
          : old,
      );
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((p) => ({
                ...p,
                conversations: p.conversations.map((c) => (c.id === v.id ? { ...c, title: v.title } : c)),
              })),
            }
          : old,
      );
      // 当前会话详情（TopBar 标题取自详情）一并就地改。
      qc.setQueryData<ConversationDetail>(["conversation", v.id], (old) =>
        old ? { ...old, title: v.title } : old,
      );
      setEditingId(null); // 立即退出编辑态（乐观）
      return { prev, prevProjects };
    },
    onSuccess: () => toast.success("已重命名"),
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      for (const [key, data] of ctx?.prevProjects ?? []) qc.setQueryData(key, data);
      toast.error("重命名失败，请重试");
    },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["conversation", v.id] });
    },
  });

  // F-074 新建项目：服务端置顶（sort_order 整体 +1），成功后就地插入缓存并展开新项目。
  const createProjectMutation = useMutation({
    mutationFn: (name: string) => apiPost("/api/projects", { name }, ProjectMutationResponse),
    onSuccess: (res) => {
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) =>
        old
          ? { ...old, items: [res.item, ...old.items.map((p) => ({ ...p, sortOrder: p.sortOrder + 1 }))] }
          : old,
      );
      setExpanded(res.item.id, true);
      setNameDialog(null);
      toast.success("项目已创建");
    },
    onError: () => toast.error("创建失败，请重试"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  // F-074 重命名项目（默认项目允许）：乐观改名，失败回滚。
  const renameProjectMutation = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      apiPatch(`/api/projects/${v.id}`, { name: v.name }, ProjectMutationResponse),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["projects"] });
      const prev = qc.getQueriesData<ProjectListResponse>({ queryKey: ["projects"] });
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) =>
        old
          ? { ...old, items: old.items.map((p) => (p.id === v.id ? { ...p, name: v.name } : p)) }
          : old,
      );
      setNameDialog(null); // 立即关弹窗（乐观）
      return { prev };
    },
    onSuccess: () => toast.success("已重命名"),
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      toast.error("重命名失败，请重试");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  // F-074 项目整组重排：乐观改序，失败回滚，onSettled 对齐真数据。
  const reorderProjectsMutation = useMutation({
    mutationFn: (ids: string[]) => apiPost("/api/projects/order", { ids }, ProjectOrderResponse),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["projects"] });
      const prev = qc.getQueriesData<ProjectListResponse>({ queryKey: ["projects"] });
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) => {
        if (!old) return old;
        const byId = new Map(old.items.map((p) => [p.id, p]));
        const items = ids
          .map((id, i) => {
            const p = byId.get(id);
            return p ? { ...p, sortOrder: i } : null;
          })
          .filter((p): p is ProjectListItem => p !== null);
        return items.length === old.items.length ? { ...old, items } : old;
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      toast.error("排序失败，请刷新后重试");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  // F-074 项目内会话整组重排（跨项目拖动在 UI 层就不发生）。
  const reorderConvsMutation = useMutation({
    mutationFn: (v: { projectId: string; ids: string[] }) =>
      apiPost(`/api/projects/${v.projectId}/order`, { ids: v.ids }, ProjectOrderResponse),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["projects"] });
      const prev = qc.getQueriesData<ProjectListResponse>({ queryKey: ["projects"] });
      qc.setQueriesData<ProjectListResponse>({ queryKey: ["projects"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((p) => {
            if (p.id !== v.projectId) return p;
            const byId = new Map(p.conversations.map((c) => [c.id, c]));
            const conversations = v.ids
              .map((id, i) => {
                const c = byId.get(id);
                return c ? { ...c, sortOrder: i } : null;
              })
              .filter((c): c is ProjectListItem["conversations"][number] => c !== null);
            return conversations.length === p.conversations.length ? { ...p, conversations } : p;
          }),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
      toast.error("排序失败，请刷新后重试");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
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

  // —— F-074 项目展开/收起：按用户记 localStorage；未记录时默认项目展开、其余收起 ——
  const meId = me.data?.user.id ?? "";
  const expandedStorageKey = `sidebar.projects.expanded.${meId}`;
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!meId) return;
    let stored: Record<string, boolean> = {};
    try {
      stored = JSON.parse(localStorage.getItem(expandedStorageKey) ?? "{}") ?? {};
    } catch {
      stored = {};
    }
    setExpandedMap(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);
  const isExpanded = (p: ProjectListItem) => expandedMap?.[p.id] ?? p.isDefault;
  const setExpanded = (id: string, value: boolean) => {
    setExpandedMap((prev) => {
      const next = { ...(prev ?? {}), [id]: value };
      try {
        localStorage.setItem(expandedStorageKey, JSON.stringify(next));
      } catch {
        // localStorage 不可用时仅本次会话内生效
      }
      return next;
    });
  };

  // 「…」下拉：开着一个时，点外面任意处关闭（菜单与按钮自身 stopPropagation）
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: PointerEvent) => {
      // 点在菜单内部（含菜单项）不关闭——React stopPropagation 在真实浏览器 PointerEvent
      // 链路上对部分合成/原生混用场景不可靠，用 DOM 归属判断兜底。
      if ((e.target as HTMLElement | null)?.closest?.("[data-project-menu]")) return;
      setMenuFor(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuFor]);

  // —— F-074 长按拖动 ——
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const rectsRef = useRef<{ id: string; mid: number }[]>([]);
  const suppressClickRef = useRef(false);

  const updateDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const collectRects = (target: DragTarget) => {
    const root = asideRef.current;
    if (!root) return;
    const selector =
      target.kind === "project"
        ? "[data-project-row]"
        : `[data-conv-list="${target.projectId}"] [data-conv-row]`;
    rectsRef.current = Array.from(root.querySelectorAll<HTMLElement>(selector)).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id ?? "", mid: r.top + r.height / 2 };
    });
  };

  const cancelPress = () => {
    if (pressRef.current) {
      clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  const rowDragHandlers = (target: DragTarget) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (dragRef.current) return; // 一次只拖一个
      const el = e.currentTarget;
      const { clientX: x, clientY: y } = e;
      const timer = setTimeout(() => {
        pressRef.current = null;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // 某些环境（jsdom/旧浏览器）不支持捕获，拖动仍可用（指针不出行即可）
        }
        el.style.touchAction = "none"; // 尽力阻断拖动用触摸滚动（部分浏览器要求手势前设置，属已知限制）
        collectRects(target);
        updateDrag({ target, overIndex: rectsRef.current.findIndex((r) => r.id === dragIdOf(target)) });
        suppressClickRef.current = true; // 吞掉拖动结束后的 click
      }, LONG_PRESS_MS);
      pressRef.current = { timer, x, y };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (press) {
        const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_CANCEL_PX;
        if (moved) cancelPress(); // 阈值前明显移动 = 滚动/划动，放弃长按
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const rects = rectsRef.current;
      let overIndex = rects.length;
      for (let i = 0; i < rects.length; i++) {
        if (e.clientY < rects[i].mid) {
          overIndex = i;
          break;
        }
      }
      if (overIndex !== d.overIndex) updateDrag({ ...d, overIndex });
    },
    onPointerUp: () => {
      cancelPress();
      const d = dragRef.current;
      if (!d) return;
      updateDrag(null);
      const draggedId = dragIdOf(d.target);
      const ids = rectsRef.current.map((r) => r.id).filter(Boolean);
      rectsRef.current = [];
      const from = ids.indexOf(draggedId);
      if (from === -1) return;
      const without = ids.filter((id) => id !== draggedId);
      let to = d.overIndex > from ? d.overIndex - 1 : d.overIndex;
      to = Math.max(0, Math.min(without.length, to));
      if (to === from) return; // 位置未变
      const next = [...without.slice(0, to), draggedId, ...without.slice(to)];
      if (d.target.kind === "project") {
        if (!reorderProjectsMutation.isPending) reorderProjectsMutation.mutate(next);
      } else if (!reorderConvsMutation.isPending) {
        reorderConvsMutation.mutate({ projectId: d.target.projectId, ids: next });
      }
    },
    onPointerCancel: () => {
      cancelPress();
      updateDrag(null);
      rectsRef.current = [];
    },
  });

  /** NavLink/项目行点击统一入口：拖动刚结束时这次 click 来自长按，吞掉。 */
  const clickAfterDrag = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
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

  /** 会话行（搜索结果与项目子列表共用；drag 缺省 = 不可拖）。 */
  const renderConversationRow = (c: { id: string; title: string }, dragTarget?: DragTarget) => {
    if (editingId === c.id) {
      return (
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
      );
    }
    const dragging = drag ? dragIdOf(drag.target) === c.id : false;
    return (
      <div
        key={c.id}
        className={`${styles.recentRow} ${dragging ? styles.rowDragging : ""}`}
        data-conv-row={dragTarget ? "" : undefined}
        data-id={dragTarget ? c.id : undefined}
        {...(dragTarget ? rowDragHandlers(dragTarget) : {})}
      >
        <NavLink
          to={`/c/${c.id}`}
          prefetch="intent"
          draggable={false} // F-074：防原生 <a> 拖拽劫持长按手势（真实浏览器会 pointercancel）
          onClick={(e) => {
            if (clickAfterDrag()) {
              e.preventDefault();
              return;
            }
            onClose?.();
          }}
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
    );
  };

  /** 插入位置指示条（拖动中渲染在目标落点）。 */
  const dropIndicator = (key: string) => <div key={key} className={styles.dropIndicator} aria-hidden="true" />;

  const renderProject = (p: ProjectListItem) => {
    const expanded = isExpanded(p);
    const projectDragging = drag?.target.kind === "project" && drag.target.projectId === p.id;
    const convDrag = drag?.target.kind === "conversation" && drag.target.projectId === p.id ? drag : null;
    return (
      <div key={p.id} className={styles.projectBlock}>
        <div
          className={`${styles.projectRow} ${projectDragging ? styles.rowDragging : ""}`}
          data-project-row=""
          data-id={p.id}
          {...rowDragHandlers({ kind: "project", projectId: p.id })}
          onClick={() => {
            if (clickAfterDrag()) return;
            setExpanded(p.id, !expanded);
          }}
        >
          {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span className={styles.projectName} title={p.name}>
            {p.name}
          </span>
          <div
            className={styles.projectActions}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.projectAction}
              aria-label={`项目更多操作：${p.name}`}
              title="更多"
              onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
            >
              <MoreHorizontal size={14} />
            </button>
            <button
              type="button"
              className={styles.projectAction}
              aria-label="新建项目"
              title="新建项目"
              onClick={() => setNameDialog({ mode: "create" })}
            >
              <Plus size={14} />
            </button>
          </div>
          {menuFor === p.id ? (
            <div className={styles.projectMenu} data-project-menu="" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={styles.projectMenuItem}
                onClick={() => {
                  setMenuFor(null);
                  setNameDialog({ mode: "rename", projectId: p.id, name: p.name });
                }}
              >
                重命名项目
              </button>
            </div>
          ) : null}
        </div>
        {expanded ? (
          <div className={styles.projectChildren} data-conv-list={p.id}>
            {p.conversations.length === 0 ? (
              <div className={styles.projectEmpty}>项目内暂无会话</div>
            ) : (
              p.conversations.map((c, idx) => (
                <div key={c.id} style={{ display: "contents" }}>
                  {convDrag && convDrag.overIndex === idx ? dropIndicator(`di-${idx}`) : null}
                  {renderConversationRow(c, { kind: "conversation", projectId: p.id, conversationId: c.id })}
                </div>
              ))
            )}
            {convDrag && convDrag.overIndex === p.conversations.length
              ? dropIndicator("di-end")
              : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {open ? (
        <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      ) : null}
      <aside ref={asideRef} className={`${styles.aside} ${open ? styles.asideOpen : ""}`}>
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

        <div className={styles.recentLabel}>{searching ? "搜索结果" : "项目"}</div>
        {searching ? (
          conversations.length === 0 ? (
            <div className={styles.recentEmpty}>未找到匹配的对话</div>
          ) : (
            conversations.map((c) => renderConversationRow(c))
          )
        ) : projects.length === 0 ? (
          <div className={styles.recentEmpty}>还没有对话，点「新建生成」开始吧</div>
        ) : (
          projects.map((p, idx) => (
            <div key={p.id} style={{ display: "contents" }}>
              {drag?.target.kind === "project" && drag.overIndex === idx
                ? dropIndicator(`di-p-${idx}`)
                : null}
              {renderProject(p)}
            </div>
          ))
        )}
        {!searching && drag?.target.kind === "project" && drag.overIndex === projects.length
          ? dropIndicator("di-p-end")
          : null}

        <div className={styles.spacer} />

        <NavLink
          to="/assets"
          prefetch="intent"
          onClick={onClose}
          className={({ isActive }) => `${styles.nav} ${isActive ? styles.navActive : ""}`}
        >
          <ImageIcon size={16} />
          资产库
        </NavLink>
        <NavLink
          to="/inspiration"
          prefetch="intent"
          onClick={onClose}
          className={({ isActive }) => `${styles.nav} ${isActive ? styles.navActive : ""}`}
        >
          <Lightbulb size={16} />
          灵感库
        </NavLink>

        <NavLink to="/account" prefetch="intent" onClick={onClose} className={styles.account}>
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

      <ProjectNameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === "rename" ? "重命名项目" : "新建项目"}
        initialName={nameDialog?.mode === "rename" ? nameDialog.name : ""}
        busy={createProjectMutation.isPending || renameProjectMutation.isPending}
        onSubmit={(name) => {
          if (!nameDialog) return;
          if (nameDialog.mode === "create") {
            if (!createProjectMutation.isPending) createProjectMutation.mutate(name);
          } else if (!renameProjectMutation.isPending) {
            renameProjectMutation.mutate({ id: nameDialog.projectId, name });
          }
        }}
        onCancel={() => setNameDialog(null)}
      />
    </>
  );
}
