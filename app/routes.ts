import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

// 集中路由表（路由真相源，docs/dev 08 §9.2）。下划线前缀 = pathless 布局。
// 阶段一：受保护前台挂 _app（mock 放行）；鉴权页挂 _auth；/admin 留阶段二。
export default [
  // 阶段二 ②：Better Auth catch-all 资源路由（/api/auth/*），无 UI（05 §6.1）。
  route("api/auth/*", "routes/api.auth.$.ts"),
  // 阶段二 ⑤：前台读/写 API（资源路由，无 UI，server-only；读供客户端 refetch、写=REST/action）。
  route("api/me", "routes/api.me.ts"),
  route("api/conversations", "routes/api.conversations.ts"),
  route("api/conversations/:id", "routes/api.conversations.$id.ts"),
  route("api/images", "routes/api.images.ts"),
  route("api/images/save", "routes/api.images.save.ts"),
  route("api/packages", "routes/api.packages.ts"),
  route("api/inspirations", "routes/api.inspirations.ts"),
  route("api/notifications", "routes/api.notifications.ts"),
  route("api/notifications/read", "routes/api.notifications.read.ts"),
  route("api/account/ledger", "routes/api.account.ledger.ts"),
  route("api/account/lots", "routes/api.account.lots.ts"),
  route("api/account/redemptions", "routes/api.account.redemptions.ts"),
  route("api/redeem", "routes/api.redeem.ts"),
  // 阶段二 ⑥：后台 API（资源路由，server-only；每个各自 requireAdmin = 双守卫之一）。
  route("api/admin/users", "routes/api.admin.users.ts"),
  route("api/admin/users/:id", "routes/api.admin.users.$id.ts"),
  route("api/admin/codes", "routes/api.admin.codes.ts"),
  route("api/admin/codes/export", "routes/api.admin.codes.export.ts"),
  route("api/admin/codes/batch/:batchId", "routes/api.admin.codes.batch.$batchId.ts"),
  route("api/admin/codes/:code", "routes/api.admin.codes.$code.ts"),
  route("api/admin/packages", "routes/api.admin.packages.ts"),
  route("api/admin/config", "routes/api.admin.config.ts"),
  route("api/admin/inspirations", "routes/api.admin.inspirations.ts"),
  route("api/admin/generations", "routes/api.admin.generations.ts"),
  route("api/admin/notifications", "routes/api.admin.notifications.ts"),
  route("api/admin/audit", "routes/api.admin.audit.ts"),
  route("api/admin/dashboard", "routes/api.admin.dashboard.ts"),
  layout("routes/_app.tsx", [
    index("routes/_app._index.tsx"), // 主对话 /（新建生成）
    route("c/:id", "routes/_app.c.$id.tsx"), // 某会话线程
    route("inspiration", "routes/_app.inspiration.tsx"), // 灵感库
    route("assets", "routes/_app.assets.tsx"), // 资产库（mock 占位）
    route("billing", "routes/_app.billing.tsx"), // 充值（做实：接住「去充值」CTA）
    route("account", "routes/_app.account.tsx"), // 账号设置（占位）
  ]),
  layout("routes/_auth.tsx", [
    route("login", "routes/_auth.login.tsx"),
    route("register", "routes/_auth.register.tsx"),
    route("forgot", "routes/_auth.forgot.tsx"),
    // #14：管理员独立登录页（同一 Better Auth 账号体系；登录后校验 role 直达 /admin）。
    route("admin/login", "routes/_auth.admin-login.tsx"),
  ]),
  // 阶段二 ⑥：后台 UI（独立 _admin 布局，requireAdminPage 守卫）。
  layout("routes/_admin.tsx", [
    route("admin", "routes/_admin._index.tsx"), // 看板
    route("admin/users", "routes/_admin.users.tsx"),
    route("admin/codes", "routes/_admin.codes.tsx"),
    route("admin/generations", "routes/_admin.generations.tsx"),
    route("admin/inspiration", "routes/_admin.inspiration.tsx"),
    route("admin/packages", "routes/_admin.packages.tsx"),
    route("admin/notifications", "routes/_admin.notifications.tsx"), // §9 广播公告
  ]),
] satisfies RouteConfig;
