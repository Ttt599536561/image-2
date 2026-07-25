# 任务：管理后台手动配置未登录首页（/welcome）画廊图片

## 背景与目标

owner 需求：管理后台要能手动配置用户端未登录时看到的首页（/welcome 落地页）
展示的图片。现状是 /welcome 画廊直接取「灵感库全部 active 卡」（表空回退种子），
管理员无法单独决定门面页展示哪些图、什么顺序。

做完后：管理员在后台「首页画廊」页面增删改查图片（本地上传或贴 URL）、
排序（上移/下移）、上下架；未登录访客打开 /welcome 即看到这份手工配置的
画廊；一条都没配置时保持现状（回退灵感库 active 卡 → 种子），保证门面永不空。

## 涉及文件 / 模块（AI 填）

- `drizzle/0008_landing_gallery.sql`（新增迁移：landing_gallery_items 表）
- `src/db/schema.ts`（表定义，对齐迁移）
- `src/contracts/admin.ts`（LandingGalleryAction zod 契约 + 上传响应）
- `src/server/admin/landing-gallery.server.ts`（新增：CRUD + 排序 + 审计）
- `src/server/reads.server.ts`（新增 loadLandingGallery()，异常/空表回退 null）
- `src/server/r2.server.ts`（新增 landing/ 前缀 key 与 putLandingImage）
- `src/server/maintenance.server.ts`（孤儿 known-set UNION landing_gallery_items.image_key）🔴
- `app/routes/api.admin.landing-gallery.ts`（新增：GET 列表 / POST 动作）
- `app/routes/api.admin.landing-gallery.upload.ts`（新增：multipart 上传）
- `app/routes/_admin.landing-gallery.tsx`（新增：后台管理页）
- `app/routes.ts` + `app/routes/_admin.tsx`（注册路由 + 导航项「首页画廊」）
- `app/routes/welcome.tsx`（loader 优先读 landing_gallery_items）
- 测试：`src/server/landing-gallery-reads.test.ts`、`app/routes/_admin.landing-gallery.test.tsx`

## 明确不做什么 ⚠️

- 不动灵感库（inspirations）及其后台页、投稿审核流。
- 不改计费/积分/账本/队列/worker/scheduler 任何逻辑。
- 不改 LandingPage 组件本身（数据形状沿用 LandingItem，零前端改版）。
- 不做「从灵感库一键选入」（可后续增强，本期不做）。
- 不改 /welcome 的其它版块与主题切换。

## 验收步骤 ⚠️

1. 未登录打开 /welcome：在无任何配置时画廊与现状一致（回退灵感库/种子）。
2. 管理员登录后台 → 侧边导航出现「首页画廊」→ 新增 2 张图（1 张本地上传、
   1 张贴 URL），填标题/分类/提示词 → 保存成功，列表可见。
3. 上移/下移调整顺序、对其中一张点「下架」。
4. 未登录刷新 /welcome：画廊只显示已上架那 1 张，且顺序/内容符合配置。
5. 上架图在库里放超过 1 小时后不被孤儿清理误删（known-set 单测覆盖）。
6. 编辑/删除二次确认生效；审计表有 create/edit/reorder/delete 记录。
7. 跑验收命令全绿（见下节），浏览器截图核对后台页与 /welcome。

## 需要跑的验收命令（AI 填）

- 最低门槛：`npm run typecheck`、`npm run test:run`
- 动页面加跑：`npm run test:e2e`（本机已知 key-modes 偶发超时按 VERIFY.md
  第三节判定）+ 浏览器截图
- 动库结构：`npm run db:test:migrate` 同步一次性测试库

## 风险与注意点（AI 填）

- 🔴 唯一高危点：上传图 `landing/…` 必须进孤儿清理 known-set，否则 1 小时后
  被当孤儿删除 = 门面丢图。已在 maintenance.server.ts UNION 并补单测。
- 后台页/API 全部走 requireAdmin / requireAdminPage；敏感写同事务 writeAudit。
- 客户端契约手写 zod，不 import db/schema（⑤ 教训）。
- 未配置时的回退链（landing 表 → inspirations → 种子）必须逐层单测覆盖，
  保证落地页永不空。
- 不触碰 CLAUDE.md「不可破坏」区（钱/队列/凭据）。

## 状态

已验收（2026-07-25，提交见 git log "feat: [F-073]"）
