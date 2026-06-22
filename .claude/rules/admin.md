---
paths:
  - "app/routes/_admin*.tsx"
  - "app/routes/api.admin.*.ts"
  - "src/server/admin/**"
---

# 后台红线（编辑 /admin 代码时必守）

> 提醒 + 路由；权威看 [docs/dev/09-admin.md](../../docs/dev/09-admin.md)。

- **双守卫**：`_admin` 布局 loader `requireAdminPage`（每请求查 DB role + 未封禁，**不吃 cookieCache**）+ 每个 `api.admin.*` 各自 `requireAdmin`。两者缺一不可。
- 敏感写**二次确认**（`ConfirmDialog`）+ 写**操作审计**（`writeAudit` 同事务 / `writeAuditHttp` 单语句；只追加、管理员不可删改自己记录、改密类 before/after 绝不落明文）。
- **#14 UX 分离**：后台无回用户端入口；未登录访问 `/admin` → `/admin/login`（非 `/login`）；已登录非 admin → `/`（不暴露后台）；登录后校验 `role=admin` 直达 `/admin`。
- 调积分调 `money/adjust`（见 [rules/money.md](money.md)）；管理员**不能封禁自己**（`setBanned` 守卫 + UI 禁本人行）。
- 删生成记录 = **硬删 + 清 R2 + 写审计**，但**账本保留**（对账走 `credit_lots`，不受删除影响）。
- 全局参数 #11：积分类键 UI 填**积分**、提交 ×1000 存 **mp**（换算只在前端边界，后端仍存 mp）。
