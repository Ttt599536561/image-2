import { Outlet } from "react-router";

// 鉴权页 pathless 布局（登录/注册/忘记密码）—— 居中卡片壳，Task #9 落地。
export default function AuthLayout() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-6)",
        background: "var(--bg-canvas)",
      }}
    >
      <Outlet />
    </main>
  );
}
