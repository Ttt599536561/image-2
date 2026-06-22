import { AuthForm } from "../../src/components/auth/AuthForm";

// #14：管理员独立登录页（/admin/login）。同一 Better Auth 账号体系；登录后校验 role=admin 直达 /admin。
export default function AdminLogin() {
  return <AuthForm mode="login" admin />;
}
