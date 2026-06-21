import { useState } from "react";
import { Outlet } from "react-router";
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

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className={styles.shell}>
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
