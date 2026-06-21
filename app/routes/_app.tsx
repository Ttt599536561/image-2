import { useState } from "react";
import { Outlet } from "react-router";
import styles from "../../src/components/shell/Shell.module.css";
import { ShellContext } from "../../src/components/shell/ShellContext";
import { Sidebar } from "../../src/components/shell/Sidebar";
import { MockProvider } from "../../src/mocks/store";

// 受保护三栏壳布局（阶段一 mock 放行；阶段二在此挂 requireUser loader guard）。
// MockProvider 提供 mock 账号/会话/积分；侧栏全局常驻（移动端抽屉）。
export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <MockProvider>
      <ShellContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
        <div className={styles.shell}>
          <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
          <main className={styles.main}>
            <Outlet />
          </main>
        </div>
      </ShellContext.Provider>
    </MockProvider>
  );
}
