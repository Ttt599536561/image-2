import { ArrowLeft, LogOut, Menu, RefreshCw, Settings2, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { authClient } from "../../src/lib/auth-client";
import styles from "../../src/components/admin/Admin.module.css";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  return null;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const logout = async () => { await authClient.signOut(); navigate("/admin/login"); };
  return <div className={styles.shell}>
    <header className={styles.mobileBar}>
      <div className={styles.mobileBrand}><Settings2 size={18} />站点维护</div>
      <button type="button" className={styles.mobileMenuButton} aria-label={mobileNavOpen ? "关闭后台菜单" : "打开后台菜单"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? <X size={20} /> : <Menu size={20} />}</button>
    </header>
    {mobileNavOpen && <button type="button" className={styles.navScrim} aria-label="关闭后台菜单" onClick={() => setMobileNavOpen(false)} />}
    <nav className={`${styles.nav} ${mobileNavOpen ? styles.navOpen : ""}`}>
      <div className={styles.navBrand}><Settings2 size={18} />站点维护</div>
      <NavLink to="/admin/system-update" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`} onClick={() => setMobileNavOpen(false)}><RefreshCw size={16} />系统更新</NavLink>
      <Link to="/" className={styles.navLink}><ArrowLeft size={16} />返回工作台</Link>
      <div className={styles.navSpacer} />
      <button type="button" className={styles.backLink} onClick={logout}><LogOut size={15} />退出管理</button>
    </nav>
    <main className={styles.main}><Outlet /></main>
  </div>;
}
