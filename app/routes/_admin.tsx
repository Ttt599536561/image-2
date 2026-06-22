import {
  Coins,
  Image as ImageIcon,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Megaphone,
  Package,
  Ticket,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { authClient } from "../../src/lib/auth-client";
import styles from "../../src/components/admin/Admin.module.css";
import { requireAdminPage } from "../../src/server/page.server";
import type { Route } from "./+types/_admin";

// 后台 _admin 布局（09 §10.1）：双守卫之一——每请求查 DB + role=admin + 未封禁，否则 redirect("/")（不暴露后台）。
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminPage(request);
  return {};
}

const NAV = [
  { to: "/admin", label: "看板", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "用户", icon: Users, end: false },
  { to: "/admin/codes", label: "兑换码", icon: Ticket, end: false },
  { to: "/admin/generations", label: "生成记录", icon: ImageIcon, end: false },
  { to: "/admin/inspiration", label: "灵感库", icon: Lightbulb, end: false },
  { to: "/admin/packages", label: "套餐 / 参数", icon: Package, end: false },
  { to: "/admin/notifications", label: "广播公告", icon: Megaphone, end: false },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  // #14：后台 UX 与用户端彻底分离——无「返回工作台」入口；唯一出口=退出登录 → 回后台登录页。
  const logout = async () => {
    await authClient.signOut();
    navigate("/admin/login");
  };
  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <Coins size={18} />
          后台管理
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            prefetch="intent"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
          >
            <n.icon size={16} />
            {n.label}
          </NavLink>
        ))}
        <div className={styles.navSpacer} />
        <button type="button" className={styles.backLink} onClick={logout}>
          <LogOut size={15} />
          退出登录
        </button>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
