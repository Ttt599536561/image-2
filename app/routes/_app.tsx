import { useState } from "react";
import { Outlet, type ShouldRevalidateFunction, useNavigation } from "react-router";
import styles from "../../src/components/shell/Shell.module.css";
import { ShellContext } from "../../src/components/shell/ShellContext";
import { Sidebar } from "../../src/components/shell/Sidebar";
import { requireUserPage } from "../../src/server/page.server";
import { loadConversations, loadMe } from "../../src/server/reads.server";
import type { Route } from "./+types/_app";

// 受保护三栏壳布局（08 §9.1）：父 loader 守卫 + 取首屏 me/会话列表（作 TanStack Query initialData）。
// 未登录 → redirect("/login?next=")；封禁 → redirect("/login?reason=banned")。
export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireUserPage(request);
  const [me, conversations] = await Promise.all([loadMe(userId), loadConversations(userId, 1, 20)]);
  return { me, conversations };
}

// ⚡ 性能：me/会话列表的新鲜度由 TanStack Query 负责（mutation onSuccess invalidate 命中 /api/me、
// /api/conversations 自动刷新），父 loader 无需在每次子路由切换（GET 导航）时重跑这两条跨境 Neon 查询。
// 跨境场景这是「点击慢半拍」的最大单点：切页签/切会话本不会改 me/会话列表。仅非 GET（理论上的 action
// 提交）时回退默认。首次进入 _app（新匹配）与整页刷新仍照常跑 loader，鉴权不受影响（子路由各自 requireUserPage）。
export const shouldRevalidate: ShouldRevalidateFunction = ({ formMethod, defaultShouldRevalidate }) => {
  if (formMethod == null || formMethod === "GET") return false;
  return defaultShouldRevalidate;
};

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  // ⚡ 导航转换态：loading 时顶部细进度条，点击后即时反馈，消除「点了没反应」的焦虑（即便底层 RTT 不变）。
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  return (
    <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      {isNavigating ? <div className={styles.navProgress} aria-hidden="true" /> : null}
      <div className={styles.shell}>
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
