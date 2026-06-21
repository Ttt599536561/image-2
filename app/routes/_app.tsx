import { Outlet } from "react-router";

// 受保护三栏壳布局（阶段一 mock 放行；阶段二在此挂 requireUser loader guard）。
// 完整三栏壳（侧栏/对话区/本次面板）在 Task #4 落地，此处先占位。
export default function AppLayout() {
  return <Outlet />;
}
