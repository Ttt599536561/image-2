# 阶段三施工计划（草拟 · 待站长批准）· 增强（上线后迭代）

> **本文件 = 阶段三的可执行蓝图 + 可勾选清单**（草拟，**待站长批准**后开工；批准后把本行改「已批准」）。
> **怎么写代码看 [docs/dev/00–11](README.md)**；**做什么/顺序/红线看这里**；**进度勾选在本文件 + [PROGRESS.md](../PROGRESS.md) 联动**。
> 基于 4 路多代理精读（spec §20/§21/§23/§24 + wireframes + **代码现状审计**）综合。**已剔除阶段二已做的部分**（资产批量选择/zip/删除已在 ⑤、灵感后台 CRUD 已在 ⑥），本计划只覆盖「增量」。

## Context
阶段二（①–⑦：账号/积分/钱链路/生图管线/前端接真/后台/cron·可观测·CI）已全部完成并对真 Neon 验证（commit 至 `55b1e50`，`phase2` 分支待签字合并 `main`）。
**阶段三 = 增强迭代，非公开上线必需**——除「成本对账真·毛利数」是上线前置硬闸（铁律②，需灰度跑量，非编码）外，其余都是体验/运营提升，可按价值增量上。
栈不变：Netlify + Neon(Drizzle) + RR8 framework(SSR) + Better Auth(admin 插件) + Supabase Storage(S3) + TanStack Query + Zod。

**推荐顺序**：P3-S1（资产高级筛选/框选，纯前端、即见效）→ P3-S2（搜索）→ P3-S3（RBAC 地基）→ P3-S4（灵感运营化）→ P3-S5（客服 360，依赖 S3）→ P3-S6（优化提示词）。P3-S7 本期不做（清单完整性）。
**严格依赖**：P3-S5 必须在 P3-S3 之后（需 `requireSupport` 守卫）。其余分片相对独立、可调序或并行。

---

## §0 开放问题（开工前请站长拍板 — 答错会返工）

| # | 问题 | 影响分片 | 默认建议 |
|---|---|---|---|
| Q1 | 资产库首屏默认日期档：现状代码默认「全部」(`range='all'`)，但规格 §24-8 写快捷默认「今天」——以哪个为准？ | P3-S1 | 倾向保留「全部」（用户图少时「今天」常空），或按 §24 改「今天」 |
| Q2 | 优化提示词是否计积分？ | P3-S6 | 建议本期**免费但限频**（防 LLM 成本），不动钱链路 |
| Q3 | 优化提示词回填策略：输入框已有文本时覆盖/追加/弹「替换当前输入?」确认？ | P3-S6 | 与灵感「一键带回」(§24-10) 范式对齐 |
| Q4 | 客服是否要独立后台布局/入口，还是复用 `_admin` 按角色显隐？短期是否仍单管理员（§23「可降级为单账号+审计」）？ | P3-S3 / P3-S5 | 短期单管理员则 S3/S5 可降级/缓做；多人协作才上 RBAC |
| Q5 | 客服「重发结果图」形态：仅展示/复制 `public_url`，还是发站内通知/邮件（无邮件基建）？ | P3-S5 | 倾向「复制下载链接 + 站内通知(notifications 表)」 |
| Q6 | 搜索量级：单用户会话/资产规模多大？决定 ILIKE 顺序扫够用还是要建 `pg_trgm`/全文索引。 | P3-S2 / P3-S4 | 初期 ILIKE + 现有索引足够，量大再上 trigram |

> **外部依赖**：阶段三**无新增外部服务/密钥**（沿用阶段二的 Neon/Storage/中转/Better Auth）。`SENTRY_DSN`/`ADMIN_ALERT_WEBHOOK` 仍可后补（缺则 no-op）。优化提示词(P3-S6) 复用既有中转 `RELAY_*`。

---

## §1 资产库高级筛选/框选补全（P0 · M）✅ 已实现（按站长「自动进行下一步」先行）
> 补齐阶段二资产库「未做半截」：后端 `loadImages` 已支持 `range=custom`+`from/to`，但前端只渲染 all/today/7d/30d、无自定义日历；批量选择有 Shift 连选/吸底条/zip/删除确认，但缺规格 §24-9 的桌面拖动框选与移动端长按进多选。**只补交互、不动后端查询/zip/删除链路。**
> **状态**：实现并 tsc 0 · test:run 44(含 `assetsSelection.test.ts` 14 例 rectsIntersect/expiringInDays/dayStr) · build 0 · assert-no-secrets PASS。**日历用原生 `<input type=date>`（零依赖、可访问、移动端原生选择器）替代「双月/范围高亮」自定义组件**——双月日历列为后续视觉打磨（非阻塞）。手势（框选 drag / 长按）逻辑已 tsc/build 验证，几何/日期纯逻辑已单测；**鉴权态 dev 预览需 DB-env 注入，留合并前手动手势 QA**。
- [x] `AssetsPage.tsx`：RANGES 增「自定义」chip → 起止 `<input type=date>`（选完即应用、无确认按钮），传 `from/to`(本地日界 ISO) 给 `useAssets({range:'custom',from,to})`；未选起始日 `enabled=false` 不发请求
- [x] 自定义可选范围 = 注册日(`me.createdAt`) ~ 今天（input min/max）；清除回「全部」（§24-8）
- [x] 桌面框选：网格区 pointer 拖拽矩形选区（仅鼠标·bulk；window move/up 追踪+5px 阈值+实时预览，叠加既有 `selected`，drag 后吞 click）
- [x] 移动端：缩略图长按（仅 touch·450ms 计时+10px 移动取消）进 bulk 并选中起手项，吞松手 click
- [x] ~~复用/新建轻量日历组件~~ → 原生 date input（零依赖）；双月日历后续打磨
- [x] 缩略图角标「N 天后过期」（≤3 天才显示，§24-5；`images.expiresAt` 已在 `ImagesResponse` 返回）

🔴 **红线**：纯前端读路径、不碰钱/扣费；删除仍走既有 owner-scoped `deleteImages`（DB 权威 + R2 尽力删）+ 二次确认范式不可绕过。
**影响**：`src/components/assets/AssetsPage.tsx`/`Assets.module.css`、`src/hooks/queries.ts`(确认透传 from/to)、新增 `src/components/ui/DateRangePicker.*`。**spec**：§12/§24-8/§24-9/§24-5、wireframes §9。

## §2 搜索（会话标题 + 资产提示词）（P1 · M）✅ 已实现
> 新增会话历史搜索（按标题 ILIKE，左栏「搜索」入口）+ 资产库按提示词搜索。对话式范式下结果须能快速跳转会话/资产，不开独立详情页。
> **状态**：实现并 tsc 0 · test:run 44 · build 0 · `scripts/search-smoke.ts` **13 检查全绿**(对真 Neon：命中/未命中/无 q 全列/owner-scoped 不串/`%` 转义不匹配全部/ILIKE 大小写不敏感) · assert-no-secrets PASS。暂用 ILIKE 顺序扫（量大才上 pg_trgm，§0 Q6）。
- [x] `reads.server.ts loadConversations(q?)`：`WHERE user_id AND (like IS NULL OR title ILIKE like)`（复用 `ix_conv_user_upd`）；`loadImages(q?)`：`AND g.prompt ILIKE like`（与 range/from/to 叠加，count 同 join generations）
- [x] `likePattern()` 转义 LIKE 元字符 `\%_`（防用户输入当通配；ILIKE 默认转义符 `\`），参数化绑定防注入
- [x] contracts：`ImagesQuery` 增 `q:string.max(200).optional()`（向后兼容）；会话搜索走路由 q 参（无契约破坏）
- [x] `api.conversations.ts`/`api.images.ts` 透传 q（≤200 截断）；`useConversations(q?)`/`useAssets` 把 q 纳入 queryKey、搜索时不用 loader initialData
- [x] 前端：侧栏「搜索」入口（替换原「敬请期待」占位）→ 搜索框 + 结果列表（点击跳 `/c/:id`，「搜索结果」/「未找到」态）；资产库筛选条加搜索框；`useDebouncedValue` 250ms 防抖 + 空态

🔴 **红线**：一律 owner-scoped（`WHERE user_id=$me`）、ILIKE 走参数化绑定防注入；搜索只读、不触发任何写/扣费。**已验**：owner-scoped + `%` 转义 smoke 全过。
**影响**：`src/server/reads.server.ts`、`src/contracts/{conversation,image}.ts`、`app/routes/api.{conversations,images}.ts`、`src/hooks/queries.ts`、`src/components/shell/Sidebar.tsx`、`AssetsPage.tsx`、新增搜索面板。**spec**：§10/§13/§24-2、§12.3。

## §3 RBAC 角色分级（超管/审核员/客服）+ 守卫扩展（P1 · M）
> 把 `users.role` 从 user/admin 扩到 user/admin/reviewer/support，新增分级守卫，作为客服 360（P3-S5）的权限地基。规格 §23 明确「角色字段尽早进模型」。
- [ ] 迁移 `0002`：`ALTER users role CHECK` 扩为 `IN ('user','admin','reviewer','support')`（不删旧值、user 仍默认、无需 backfill）
- [ ] `schema.ts users_role_chk` 同步扩；Better Auth admin 插件 role 配置同步（双写 role 沿用 `promote-admin.ts` 范式）
- [ ] `guard.ts`：新增 `requireRole(request, allowed[])` + 便捷 `requireSupport`(admin∪support)；`requireAdmin` 仍仅 admin（动钱/配置/发码）
- [ ] `promote-admin.ts` 扩为可设任意角色（或新增 `set-role` 脚本），双写 `users.role` + Better Auth `user.role`
- [ ] `page.server.ts` 增 `requireSupportPage`/`requireRolePage`
- [ ] 审计 action 枚举为后续客服操作预留（resend_image/reset_pw_cs/unban 等）

🔴 **红线**：CHECK 只扩不删（向前兼容）；**客服严禁动余额/配置/发码**——redeem/adjust/codes/packages/config 路由仍 `requireAdmin`（非 `requireSupport`）；敏感路径仍 `requireUserStrict` 每请求查 DB、封禁双源 fail-closed 不变；角色变更双写 + 落审计、不可越权改自己角色。
**影响**：`drizzle/0002_*.sql`、`src/db/schema.ts`、`src/lib/{guard,auth}.ts`、`src/server/page.server.ts`、`scripts/promote-admin.ts`、`audit.server.ts`。**spec**：§23、05 §6.7、09 §10.1。

## §4 灵感库运营化（DB 级搜索 + 排序/品类完善）（P2 · M）
> 当前 `loadInspirations` 先全量查表再内存过滤（数据少可接受），后台 CRUD 已在阶段二完成。本片把搜索下沉 SQL + 补品类规范化与前台瀑布流细节，防灵感卡增多后内存过滤退化。运营增强、非阻塞。
- [ ] `reads.server.ts loadInspirations`：category/q 下沉为 SQL `WHERE active=true AND (category=$c) AND (title/summary/prompt ILIKE %q%)`，种子 fallback 仅表空时
- [ ] 可选 ix：量大才上 `pg_trgm`，否则 ILIKE 顺序扫足够
- [ ] 品类规范化：从 `inspirations DISTINCT category` 动态出品类 Tab，空品类归「全部」
- [ ] 前台 `InspirationPage`：瀑布流保留原比例（回填 cover width/height）、品类 Tab + 实时搜索
- [ ] 后台 `_admin.inspiration`：排序编辑体验完善（已有 CRUD，补排序拖拽/批量上下架可选）

🔴 **红线**：灵感库只读展示 + admin 写，无钱无越权；前台只展示 `active=true`；`cover_url` 为前端只读公有 URL（不暴露 storage_key）。
**影响**：`reads.server.ts`、`inspirations.server.ts`、`contracts/inspiration.ts`、`api.inspirations.ts`、`InspirationPage.tsx`、`_admin.inspiration.tsx`。**spec**：§13、09 §10.4、wireframes §10/§14/§17。**依赖**：建议在 P3-S2 之后（搜索范式统一复用）。

## §5 客服 360 视图 + 客服干预操作（P2 · L）
> 输入邮箱一屏看用户全景（余额/分批次有效期/流水/兑换/生成历史含失败原因/并发/封禁）+「查与重发不改余额」客服操作。后端 `getUserDetail` 已聚合 ~90% 数据；本片补聚合 + 一个 support 可达的 360 页 + 客服干预。**补偿积分/解封是超管专权，客服只上报/查看。**
- [ ] `admin/users.server.ts getUserDetail` 补：兑换记录(`redeem_codes WHERE redeemed_by`)、近期生成历史(`generations` status/error_code/error/duration 倒序 N 条)、即将过期积分汇总
- [ ] 新增 `/ops/cs-360?email=` 或 `_admin.cs.tsx`（`requireSupportPage`，admin∪support）：渲染 360 模块 + 客服浮动操作栏
- [ ] 客服可做：重发结果图(取 `images.public_url` 给下载/复制，不改钱)、重置密码(Better Auth 改密 + 吊销会话 + 不记明文 + 二次确认 + 审计 `reset_pw_cs`)、查封禁状态
- [ ] 解封/补偿积分/调并发：守卫层面仍 `requireAdmin`（客服按钮置灰，标「需超管」）
- [ ] 所有客服写操作落 `audit_log`(adminId=客服 id + reason/ip)

🔴 **红线**：**客服严禁改余额/发码/改配置**——钱类操作必须 `requireAdmin` 拦截、不能只靠前端隐藏；重置密码不落明文 + 吊销全部会话；重发图只读 `public_url`、不重生成/不扣费/不绕保留期；360 跨用户读 = `requireSupport` + 落访问审计；补偿积分若日后开给客服必须走 ③ `adjustCredit` 同事务、不出负。
**影响**：`admin/users.server.ts`、`api.admin.users.$id.ts`(或新 cs 路由)、新增 `_admin.cs.tsx`/`_ops.*`、`guard.ts`(requireSupport 来自 S3)、`audit.server.ts`。**spec**：§23、wireframes §16（用户详情可复用）、09 §10.3。**依赖**：**P3-S3 必须先做**。

## §6 优化提示词按钮激活（P2 · M）
> 把 Composer 现为 disabled 占位的「优化提示词」药丸（`Composer.tsx` title=敬请期待）改为实功能：调中转/LLM 润色用户输入为更完整提示词，成功后回填 Composer 并滚到底（**不自动发送**）。参考图按钮仍保留占位。受铁律约束：中转同步阻塞、Key 只在 server 注入。
- [ ] 新增 server 端点 `optimizePrompt`（netlify function 或 RR action）：`requireUserStrict` → 调中转文本优化（Key 从 env，复用 `relay.ts` 风格 server-only 注入 + 脱敏 + 失败归一化）
- [ ] 限流：复用 `src/server/rateLimit.ts`（events 窗口，按用户限频，防刷 LLM 成本）
- [ ] Composer：药丸去 disabled，点 → loading → 回填 textarea + 滚到底；失败给 toast、不清空原输入
- [ ] 计费决策见 §0 Q2（建议免费但限频）；回填策略见 §0 Q3
- [ ] 其余占位（参考图）保持「敬请期待」不动

🔴 **红线**：中转/LLM Key 只在 server 注入、绝不进客户端 bundle（assert-no-secrets CI 兜底）；优化调用须限流防成本失控（铁律②）；中转报错回前端先脱敏（复用 `redactText`）；不自动发送/无确认不覆盖。
**影响**：`Composer.tsx`/`Composer.module.css`、新增 `netlify/functions/optimize-prompt.ts` 或 `api.optimize.ts`、`relay.ts`(或新 server 文件)、`rateLimit.ts`、新增 optimize 契约。**spec**：§2.2/占位按钮、§12.3。**依赖**：无、与钱链路无交集。

## §7 （更远 · 本期不做）图生图 / 多图 / 单图编辑 / 订阅真实支付（deferred）
> 规格 §21/§2.2 明确本期不做。占位入口保留「敬请期待」，**不隐藏不灰化替代**。列此仅作清单完整性。
- 不实现，仅记边界：Composer 参考图药丸保持占位；积分模型/队列/并发模型已冻结，未来这些功能须兼容现有 FIFO 批次 + DB-as-queue 状态机 + n=1 固定。

🔴 **红线**：不得为这些功能临时改积分定价、队列中间态或扣费幂等键；支付仍走第三方店铺 + 兑换码，不接真实支付通道。

---

## 本期明确不做（deferred 清单）
| 项 | 原因 |
|---|---|
| 图生图 / 参考图 | §2.2 复杂度高、用户比重不高；占位「敬请期待」 |
| 一次多图（n>1） | §2.2；与 `uq_debit`(按 generation)/成本铁律/n=1 强绑定，牵连钱链路 |
| 单图编辑（局部重绘/扩图） | §2.2 后续重点、本期暂缓；依赖图生图先落地 |
| 订阅 / 真实支付通道 | 商业模式已定=一次性充值+兑换码（§19/§23）；支付由第三方店铺处理 |
| 配置中心 + 变更回滚 | §23 运营进阶 later；阶段二已有 app_config + 参数校验 + 审计，集中化非阻塞 |
| 内容审核 / 中国 AIGC 合规 | §21 站长决策本期不做、风险自担；审核固定宽松(low)，规模化后回补 |
| 邮箱/IP 限流、子 Key 隔离、邮件基建 | §14 现以每用户积分闸口作主防护；规模化薅号时再补；找回密码仍「联系站长重置」 |
| DB-as-queue → Redis/BullMQ/QStash | §20/01 §2.5 规模化后再做；`generations` 抢占式状态机不变 |
| 退款/争议处理 | §23 later；撤销赠送走 `adjust`(已有)，退真金涉第三方对账，并入 CS 360 时仅「上报超管」 |

## 上线前置（非编码 · 与阶段三并行/独立）
- [ ] **成本对账真·毛利数（铁律②·硬闸）**：上线灰度 ≥200 张取 p95 GB-hour、算单图成本对账 0.07，**毛利>0 才放量**。方法论 + 对账表占位见 [cost-reconciliation.md](cost-reconciliation.md)。**需上线跑量后填实测数**，本阶段无法编码完成。

## 执行节奏
- 站长批准本计划（尤其 §0 六个开放问题）后开工。
- 在 `main`（或 `phase2` 合并后）上开 `phase3` 工作分支。
- 按推荐顺序推进；**P3-S5 依赖 P3-S3**；每片各自验证（前端 preview/对真 Neon 冒烟，按片性质）。
- 每做完一项当场把 `[ ]` 改 `[x]` + 联动 [PROGRESS.md](../PROGRESS.md)；状态只在本文件 + PROGRESS 维护。
- 涉钱/权限的片（S3/S5）保持阶段二红线：owner-scoped、守卫层拦截不靠前端隐藏、审计留痕、敏感写二次确认。
