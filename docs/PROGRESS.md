# 进度交接日志

> 本文件是 AI 的"交接班记录本"。每次关会话前 AI 必须在"会话日志"区
> 顶部追加一条固定格式的记录。出处：Anthropic《Effective Harnesses for
> Long-Running Agents》的 progress file + git history 双保险机制。

## 当前状态速览

> 最后更新：2026-07-26（生产上线 v0.2.9）

- 现在做到哪：
  - 代码线：本地 main 已完成 /welcome 公开落地页、三轮视觉改版
    （F-070/F-071）、方案 B（F-072：根路径即门面）、F-073（管理后台
    手动配置未登录首页画廊）、v0.2.8 文案两条（资产库 7 天提示 + 兑换码
    获取链接），以及 **F-074/F-075 侧边栏项目分组会话与长按拖动排序**
    （0777353，已随 v0.2.9 上线），工作区干净。
  - 发布线：**生产已跑 v0.2.9**（2026-07-26 第二次受控更新，
    0.2.7 → 0.2.9 跨版本直升：v0.2.8 文案两条 + F-074/F-075 侧边栏
    项目分组；迁移 0009 已应用，存量会话自动归档默认项目；公网
    /healthz 204、/welcome 200）。首次受控更新（2026-07-25，
    0.2.0 → 0.2.7）曾连续修复三个宿主环境潜伏缺陷（jq 1.6 校验、
    /root/.docker 只读、UMask=0077 镜像权限），对应 v0.2.4/v0.2.5/v0.2.7
    三个补丁发布。
- 下一步做什么：**任务队列为空**（F-074 挑刺评审已由 owner 于
  2026-07-26 自行完成，无待办）。owner 准备新开会话提新需求。新会话
  开始先按 CLAUDE.md SOP 读本文件 + FEATURES.md。
- 已知风险/坑：
  - e2e key-modes 在本机已从"偶发超时"变为高频失败：2026-07-25 对照实验
    显示**无改动的基线（494e819）同样失败**（断言 已完成 toHaveCount(2) → 0），
    判定为本机 Windows dev 轮询环境问题，非产品缺陷；建议后续在 CI/Linux
    跑 e2e（判定规则见 VERIFY.md 第三节）。
  - 本机 dev 库与一次性测试库已分离：`.env` → 5433/ai_image_dev，
    `.env.test` → 5433/ai_image_test（此前同库会触发 test-env-guard 拒绝；
    分离是 2026-07-25 做的，dev 库已迁移 0000-0008）。
  - 本机 Node 为 v24（项目要求 22），目前能跑，typecheck/test 无影响。
  - 宿主 systemd 单元 UMask=0077：生产树文件仍是 600/700 混合权限——
    无害（v0.2.7 Dockerfile 已归一化镜像内权限，后续更新不受影响），
    不要去手动 chmod 生产树（deploy/backups 必须保持私有）。

## 会话日志（新条目追加在最上面，必须按此格式）

### [2026-07-26] F-074 挑刺评审关闭：任务队列清空
- 任务来源：owner「不需要评审，我已经评审了，更新文档任务状态为空」
- 完成了什么：任务卡 2026-07-25-sidebar-projects.md 风险区第 2 条
  「验收前安排挑刺评审会话」标注 owner 已自行评审完成、无需另开挑刺
  会话；状态区追加「挑刺评审已由 owner 自行完成，任务全部关闭，无
  待办」；本文件速览「下一步做什么」改为任务队列为空
- 下一步：等 owner 新需求；新会话先按 CLAUDE.md SOP 读本文件 + FEATURES.md

### [2026-07-26] 生产上线 v0.2.9：跨版本受控更新（0.2.7 → 0.2.9）
- 任务来源：owner「部署成功了，更新所有文档状态」
- 完成了什么：
  - owner 已在 /admin/system-update 完成受控更新并确认部署成功；本会话
    实测公网 https://one-image2.tangguo.xin /healthz 204、/welcome 200
  - 本次跨版本直升（0.2.7 → 0.2.9）：v0.2.8 文案两条（资产库 7 天提示 +
    兑换码获取链接）+ F-074/F-075 侧边栏项目分组会话；迁移 0009_projects
    已在维护窗口自动应用，存量会话归档默认项目
  - 全目录文档状态刷新到生产 v0.2.9 基线（commit 407cdea）：CLAUDE.md、
    README、FEATURES、development、redesign-requirements、requirements、
    dev/00–11、deploy、local-acceptance、tasks 等；刻意保留的历史记录
    （首次受控更新修复史、0.2.7 验证记录、旧日志条目）不动
- 下一步：等 owner 新需求；新会话先按 CLAUDE.md SOP 读本文件 + FEATURES.md

### [2026-07-25] 发布 v0.2.9：侧边栏项目分组会话上线更新通道
- 任务来源：owner「发版」
- 完成了什么：package.json + lock 同步 bump 0.2.9；`release:validate
  --tag v0.2.9 --latest-tag v0.2.8` 通过；推送 main（407cdea）+ tag v0.2.9，
  CI 已发布 stable/latest Release v0.2.9（Full Changelog v0.2.8...v0.2.9）
- 下一步：owner 在 /admin/system-update 点更新；本次含 0009_projects 迁移
  （projects 表 + conversations 两列 + 存量会话归档），更新器会在维护窗口
  自动跑迁移，生产升级后存量用户首次进入即完成默认项目归档

### [2026-07-25] F-074/F-075 侧边栏项目分组会话：已验收（0777353）
- 任务来源：owner「开工」（需求卡 tasks/2026-07-25-sidebar-projects.md，
  Q1–Q6 已拍板，Q3=新项目插列表首部）
- 完成了什么：
  - 数据层：`projects` 表 + `conversations.project_id/sort_order`（迁移
    0009_projects.sql，幂等；存量会话一次性归入各自懒创建的默认项目并按
    updated_at 倒序编号）；`uq_projects_user_default` 部分唯一索引做并发幂等键
  - 服务端/契约/路由：loadProjects/createProject（置顶 shift+1）/
    renameProject/reorderProjects/reorderProjectConversations（整组集合一致
    校验，不符 400）；`api.projects(.order/$id/$id.order)` 四端点已注册
  - enqueue：新会话在创建事务内 ensureDefaultProject + sort_order=min-1
    置顶归入；_app loader 与 useProjects 水合首屏
  - 前端：Sidebar 最近区重构为项目区（文件夹图标、点击展开/收起记
    localStorage、hover 出现 …（重命名居中弹窗）与 +（新建居中弹窗））、
    ProjectNameDialog 组件、Pointer Events 长按 350ms 拖动排序（同项目内/
    项目间，跨项目在 UI 层不发生）、乐观更新+回滚全沿用现有模式
  - 排坑两个：① <a> 原生 HTML5 拖拽会劫持真实浏览器长按手势（pointercancel）
    → NavLink draggable={false}；② 菜单外点关闭用 data-project-menu DOM
    归属判断（stopPropagation 对合成/原生混用不可靠）
  - e2e fixture 同步镜像 enqueue 归属逻辑（harness 直插 DB 绕过服务端）
- 验收证据：
  - `npm run typecheck` 绿；`npm run test:run` 61 文件 487 通过 1 跳过
    （新增 projects.server 12 例 + Sidebar 组件 6 例）
  - `npm run db:test:migrate` applied 0009；e2e sidebar-projects.spec
    9 步全过（空态→默认项目→展开收起→二次生成→新建→重命名→会话拖动→
    项目拖动→刷新持久化）；全量 e2e 仅 key-modes 既有本机失败（与基线一致）
- 下一步：等 owner 发版指令（bump + tag 走既有 release 流程）；生产升级后
  存量用户首次进入即完成默认项目迁移
- 注意：移动端长按拖动在部分浏览器可能触发侧栏滚动（touch-action 需手势前
  设置，属已知限制）；任务卡「明确不做」清单不变（无删除项目/无跨项目移动）

### [2026-07-25] 需求文档：侧边栏「项目」分组会话（未开工）
- 任务来源：owner 新需求五条（侧边栏最近对话改为项目分组，参考
  codex 类工具 + 参考图），明确「先写需求文档，不着急开发」
- 完成了什么：
  - 任务卡 `tasks/2026-07-25-sidebar-projects.md`（按 TEMPLATE.md：
    需求细则 R1-R6、涉及文件、明确不做、验收步骤、验收命令、风险、
    6 个待确认问题 Q1-Q6）
  - 参考图存至 `docs/refs/sidebar-projects-reference.png`；tasks/README
    已登记
  - 要点：默认项目懒创建、新会话自动归入、项目内长按拖动排序
    （跨项目回弹）、项目排序、点击展开/收起、hover 出现 `...`（重命名
    弹窗）与 `+`（新建弹窗）；存量会话迁移是最大风险点
- 下一步：Q1–Q6 已全部拍板（Q3 = 新项目插列表首部；其余采纳建议），
  需求收口待开工；开发前需先安排数据结构变更，验收前安排挑刺会话

### [2026-07-25] 发布 v0.2.8：资产库 7 天清理提示 + 兑换码获取入口
- 任务来源：owner 新需求两条（文案/提示），随后「发布更新吧」
- 完成了什么：
  - F-020：/assets 副标题改为「资产库图片仅保存7天，过期自动清理，
    请及时下载保存」（批量管理模式提示语不变）
  - F-032：/billing 兑换码充值卡片标题下新增一行提示「前往
    https://api.tangguo.xin/ 获取兑换码」，链接新标签页打开
  - 按 Git 纪律分两次 feat 提交（4773d81 / 374c8cf），版本号
    package.json + package-lock.json 同步 bump 至 0.2.8
  - `release:validate --tag v0.2.8 --latest-tag v0.2.7` 通过；
    推送 main（4979eb0）+ tag v0.2.8，CI 已发布 stable/latest
    Release v0.2.8（github-actions，Full Changelog v0.2.7...v0.2.8）
- 验收证据：
  - `npm run typecheck` 绿；`npm run test:run` 59 文件 469 通过 1 跳过
  - e2e key-modes 既有失败复现于干净基线（186ad4e），与本次改动无关，
    判定同「已知风险」节（本机 Windows 轮询环境问题）
- 下一步：owner 在 /admin/system-update 检查更新并确认，把生产从
  v0.2.7 升到 v0.2.8（维护窗口数分钟，自动排空+备份+迁移）

### [2026-07-25] 生产上线 v0.2.7：三连根因修复，受控更新首次全链路跑通
- 任务来源：owner「发布上线吧」（接 F-073 会话）
- 完成了什么：
  - 先发 v0.2.3（首页画廊）→ 生产更新卡死 → 连续定位修复三个潜伏
    宿主环境缺陷，最终 v0.2.7 上线成功
  - 根因①：Debian 12 的 jq 1.6 `--stream --slurp` 把流式闭合事件拆成
    第二个 slurp 值 → 更新器重复键校验恒失败 → 任何请求被 set_failure
    静默拒绝，systemd 重启循环 55 次（7-15 起卡 10 天）。修复：改
    `-n --stream` + `inputs` 聚合（ec37aa7 → v0.2.4）；仓库自带更新器
    测试套件在生产 jq 1.6 上实测 PASS
  - 根因②：单元 ProtectSystem=strict 下 /root 只读，docker CLI
    `mkdir /root/.docker` 中止构建 → UPDATE_FAILED 自动回滚。修复：
    更新器导出 `DOCKER_CONFIG=$CONTROL_ROOT/.docker`（5e12bdc → v0.2.5）
  - 根因③：单元 UMask=0077 → git checkout 出 600 root:root 文件 →
    镜像内 USER node 读 package.json、drizzle/*.sql 全 EACCES →
    v0.2.5/v0.2.6 两次 INTERRUPTED_AFTER_MIGRATION。修复：Dockerfile
    运行层 `COPY --chown=node:node --chmod=0644`（ebc13ff → v0.2.6）+
    构建层 `chmod -R a+rX /app`（c18250e → v0.2.7）
  - 两次中断均按预案 `updater recover <REQUEST_ID>`（pg_restore 备份 +
    旧镜像回切），站点分钟级回 v0.2.0，零数据损失
  - 宿主热修复：/usr/local/sbin 更新器换 v0.2.5 tag 精确内容（md5 校验），
    清 7-14 过期请求/预约，initialize（idle/0.2.0）+ .path 重启；
    经认证后台 API（与 UI 同路径）发起更新，审计齐全
- 验收证据：
  - requestId 453794fb-354c-4421-a179-f727faf16d8e：13:06:25 → 13:09:16
    completed，maintenance=false，backupId 20260725T130630Z
  - 迁移 0007_generation_source_image + 0008_landing_gallery 于
    13:09:08 applied，app_migrations 共 9 行
  - 宿主更新器 md5 == `git show v0.2.7`（a4b05426…，自更新生效）；
    生产树 HEAD=db1703f（v0.2.7）
  - 公网 /healthz 204、/welcome 200（含 gallery/灵感内容）；后台
    system-update API：build 0.2.7 / phase completed / enabled；
    /api/admin/landing-gallery 200；audit_log 有 system_update_start 记录
  - v0.2.4/v0.2.5/v0.2.7 三次发布 CI + release job 全绿，均为 stable Latest
- 遗留与清理（2026-07-25 收尾复核）：宿主保留 7 份备份
  （20260712T040301Z/20260712T084145Z/20260713T145807Z/20260725T123528Z/
  20260725T124505Z/20260725T125751Z/20260725T130630Z，恰在保留策略内）
  与 3 份旧更新器脚本（/root/ai-image-workshop-update.pre-v0.2.2.5286434、
  .pre-v0.2.3-recovery.bak、.pre-v0.2.4-hotfix.bak，小文件，安全留存）；
  两个失败构建的悬空镜像与全部构建缓存已 prune（释放约 4.5G，
  :latest=v0.2.7 不受影响）；已合并的旧远程分支
  codex/admin-system-updater 已删除；tasks/ 四张当日任务卡均已验收；
  控制目录无残留请求/预约/checkpoint，web-run 迁移容器为 --rm 已自动清理

### [2026-07-25] 管理后台手动配置未登录首页画廊（F-073）
- 任务来源：owner 口头需求"管理后台要能手动配置用户端未登录时看到的首页
  展示的图片"（tasks/2026-07-25-admin-landing-gallery.md）
- 完成了什么：
  - 新表 `landing_gallery_items`（迁移 0008 + schema.ts），与灵感库解耦
  - 契约 LandingGalleryAction（zod）+ 上传响应；server CRUD/排序/审计
    （src/server/admin/landing-gallery.server.ts）
  - API：/api/admin/landing-gallery（GET/POST）+ /upload（multipart 魔数嗅探）
  - 后台页 /admin/landing-gallery + 侧边导航「首页画廊」（沿用灵感库交互）
  - r2.server 新增 landing/ 前缀 putLandingImage；🔴 高危点：
    maintenance 孤儿清理 known-set UNION landing_gallery_items.image_key
    （否则在用门面图超 1h 被误删）
  - reads.server 新增 loadLandingGallery()（空/异常 → null 回退）；
    welcome loader 优先读配置（全量上架卡），未配置回退灵感库 slice(14)
  - 新增测试 14 条：孤儿保护 2、读路径 5、welcome 回退链 3、后台页组件 4
- 验收证据：
  - `npm run typecheck` → 退出码 0
  - `npm run test:run` → 59 文件 469 通过/1 跳过（含新增 14 条）全绿
  - `npm run db:test:migrate` → applied 0008_landing_gallery.sql
  - `npm run test:e2e` → key-modes 同一断言连续失败；**基线对照实验**
    （stash 全部改动后在 494e819 跑）同样失败 → 本机既有轮询环境问题，
    非本次缺陷（详见状态速览）
  - `npm run build` → 成功；`npm audit --audit-level=high` → 0 high
  - 浏览器实操（Playwright 真实点击，脚本用后已删）：管理员登录 →
    首页画廊空态 → 新增「山间晨雾」（贴 data URL）→ 列表可见上架 →
    未登录 /welcome 展示该图 → 后台下架 → /welcome 回退灵感库（图消失）。
    截图 4 张存 ../shots/f073-*.png
- 提交记录：见 git log "feat: [F-073]" / "docs: [F-073]"
- 环境变更：本机 `.env` dev 库与一次性测试库分离（5433/ai_image_dev ↔
  5433/ai_image_test；此前同库触发 test-env-guard 拒绝），dev 库已迁移
  0000-0008，本地 `npm run dev` 可用
- 遗留问题：e2e key-modes 本机高频失败（基线同败，环境问题）；生产上线
  前需在 CI/Linux 环境复跑 e2e
- 下一步建议：随下次发布上线后，管理员即可在 /admin/landing-gallery
  配置门面图；可评估「从灵感库一键选入」增强

### [2026-07-25] 修复 CI 依赖审计失败（3 个 high 漏洞）
- 任务来源：owner 收到 GitHub CI 失败通知（tasks/2026-07-25-ci-audit-fix.md）
- 根因：GitHub CVE 库新披露 advisory 命中已锁定版本（react-router 8.0.1
  RSC CSRF、better-auth 1.6.20 magic-link 劫持、postcss 路径遍历），非
  本次代码引入；本次 push 触发 CI 暴露了它。教训：push main 前必须本地
  跑 VERIFY.md 第四节（build/audit），push 后必须盯 CI 状态——已补记纪律。
- 完成了什么：react-router 四件套 8.0.1→8.3.0、better-auth 1.6.20→1.6.25、
  postcss→8.5.23（npm audit fix）；攻击面评估：两漏洞均不适用本项目
  （不用 RSC Mode、未启用 magicLink/emailOTP），但门禁必须绿
- 验收证据：本地 `npm audit --audit-level=high` 退出码 0；typecheck 0；
  test:run 55 文件 455 过/1 跳过；build 成功；dev 冒烟 / →302 /welcome、
  /login 200、/welcome 200；push 后盯 CI（bd98d00）至 success
- 提交记录：bd98d00
- 遗留问题：4 个 moderate（esbuild 经 drizzle-kit、valibot）修复需破坏性
  升级，不动；npm 对钉死精确版本的 RR 包有 ERESOLVE 死结，解法为
  `--legacy-peer-deps` 显式升级后普通 install 自洽（已验证）
- 下一步建议：无；CI 纪律见 VERIFY.md 可补充"push 后盯 CI"一条

### [2026-07-25] 方案 B 落地：根路径即门面（F-072）
- 任务来源：owner 拍板"做了吧"（tasks/2026-07-25-root-landing.md）
- 完成了什么：
  - `_app.tsx` 父 loader：未登录访问根路径 / → 302 /welcome（其余受保护
    页 /assets 等照旧 302 /login?next=，已验证未误伤）
  - `welcome.tsx` loader：已登录访问 /welcome → 302 回 /（闭环，无循环）
  - welcome 页 title 改为「one-image2 · 一句话生成你想要的画面」
  - FEATURES.md 新增 F-072 并 ✅；任务卡标记已验收
- 验收证据：typecheck 退出码 0；test:run 55 文件 455 过/1 跳过；
  curl 双向跳转实测 + Playwright 截图（/ → /welcome 200 完整渲染）
- 提交记录：<见 git log "feat: [F-072]">
- 遗留问题：无。已知取舍：URL 显示 /welcome（302），非根域名 200 直渲
  染——换来零路由结构改动；owner 日后在意 URL 可再做直渲染版
- 下一步建议：下次发布上线后，访客打开 one-image2.tangguo.xin 即见
  落地页

### [2026-07-25] 画廊改紧密照片墙：去白框 + 12px 缝隙 + LPT 均衡分列
- 任务来源：owner 反馈"图片之间大量留白、感觉割裂"（附截图圈出列底空洞）
- 完成了什么：
  - 卡片去白底/边框/装裱边/常驻标题栏，图片铺满整卡，整面墙由画面构成
  - 标题+分类标签并入 hover 浮现层（黑渐变底，标题 14px 加粗白字）
  - 缝隙 space-5(20px) → space-3(12px)
  - 弃用 CSS `columns` 自动分列（高图堆同列、邻列底部空出一大块），改为
    `distributeToColumns()`：按宽高比降序后逐张放入当前最矮列（LPT 装箱），
    列数由 `useGalleryColumns()` 按视口宽度 2/3/4/5 自适应（SSR 默认 5）
  - 画墙 padding space-8 → space-6，作品区域更大
- 验收证据：`npm run typecheck` 退出码 0；`npm run test:run` 55 文件
  455 过/1 跳过；Playwright 截图 3 张（2560 宽屏/hover 浮现/1280 窄屏 4 列），
  列尾差 ≈ 自然 Pinterest 尾差，无整列空洞（脚本用后已删）
- 提交记录：c14beba
- 遗留问题：无（真实作品数量多于种子 10 张时尾差会更不明显）
- 下一步建议：刷新 /welcome 验收；后续可考虑方案 B（根域名指向落地页）

### [2026-07-25] 画廊融入感改版：占位图暖调重绘 + 装裱卡 + 衬底画墙
- 任务来源：owner 反馈画廊"没有融入感，图片不像跟网站一体"（附截图）
- 完成了什么：
  - src/lib/placeholder.ts 重绘：荧光绿/亮紫高饱和平涂 → 与网站同源的暖调
    低饱和渐变（陶土/沙金/橄榄/灰蓝/暖褐五色系）+ 颗粒纹理 + 白色内框线
  - 画廊 section 加 `--bg-subtle` 米灰衬底"画墙"（圆角、左右 padding）
  - 每张图卡加白色装裱边（cardImgWrap margin），卡片间距 space-4→5
- 验收证据：`npm run typecheck` 退出码 0；`npm run test:run` 55 文件
  455 过/1 跳过全绿；2560px 宽屏 Playwright 截图确认观感（脚本用后已删）
- 提交记录：2c10b00
- 遗留问题：无（上线后真实 AI 作品照片天然更和谐，无需再调）
- 下一步建议：刷新 /welcome 验收观感；后续可考虑方案 B（根域名指向落地页）

<!-- 模板：
### [YYYY-MM-DD] <会话主题>
- 任务来源：tasks/<对应任务卡> 或口头需求
- 完成了什么：<逐条列，对应 FEATURES.md 编号>
- 验收证据：<贴了哪些命令、退出码、截图说明>
- 提交记录：<git commit 短哈希列表>
- 遗留问题：<没有就写"无">
- 下一步建议：<一句话>
-->

### [2026-07-25] /welcome 落地页重构（品牌+叙事+动效）与主题切换
- 任务来源：owner 反馈"图片硬怼、缺乏高级优雅的连贯体验"+ 增加 image-2
  品牌露出 + 默认浅色/可切深色
- 完成了什么：
  - 品牌：导航与页脚改为 one-image2，Hero 徽章"由 image-2 模型驱动"
  - Hero 重构：左文案右叠层浮动画卡（陶土光晕+浮动动画）+ 提示词打字机
  - 新增"看见魔法发生"演示卡：对话气泡 → 出图 → 二次编辑 → 新图
  - 画廊升级：画框式排布，hover 图片微放大并浮现该图提示词
  - 动效系统：Reveal 滚动浮现（IntersectionObserver，尊重
    prefers-reduced-motion）、毛玻璃吸顶导航、按钮/卡片 hover 微交互
  - 主题：落地页导航加明暗切换按钮（复用全站 cookie 机制，默认浅色
    为原有行为，用户此前见深色系浏览器 cookie 残留）
  - 测试基建：setup.ts 补 matchMedia/IntersectionObserver stub
- 验收证据：
  - `npm run typecheck` 退出码 0；`npm run test:run` 455 通过/1 跳过
  - 浏览器截图验收：浅色默认/点切换后深色/390px 手机版/逐屏滚动五屏
    （y=0/750/1500/2250/3000）各版块均正确浮现与布局
- 提交记录：见本次提交
- 遗留问题：画廊与演示卡当前显示种子占位图（本地库无真实作品），
  生产库有真实灵感卡后自动替换
- 下一步建议：部署上线后可做方案 B（根域名指向落地页）

### [2026-07-25] 注册页文案修复 + /welcome 公开落地页
- 任务来源：owner 两点需求（tasks/2026-07-25-landing-page.md）
- 完成了什么：
  - [F-001] 去掉注册页固定"注册即送 0.14 积分"文案（AuthForm.tsx）
  - [F-070] 新增公开落地页 /welcome：Hero/真实作品画廊/三大能力/三步上手/
    特色条/底部 CTA 六版块，数据复用 loadInspirations()（表空自动回退种子），
    无需登录；新增组件测试 2 条
- 验收证据：
  - `npm run typecheck` → 退出码 0
  - `vitest run src/components/landing src/components/auth` → 2 文件 3 用例全过
  - Playwright 截图验收：1440px 与 390px 两种宽度全页截图，布局与响应式正常
    （本地画廊显示种子占位卡为预期回退，生产库有真实作品即显示真实封面）
- 提交记录：见本次提交
- 遗留问题：
  1. 落地页尚未部署到生产（下次发布时随版本上线）
  2. 线上启用后建议把根域名 `/` 的未登录访问导向 /welcome（方案 B，未做）
- 下一步建议：部署后可让挑刺会话审一遍落地页的 SEO/加载性能

### [2026-07-25] 补跑资金与端到端验收（红灯转绿）
- 任务来源：基线验收遗留的两盏红灯（owner 装好 Docker Desktop 后补跑）
- 完成了什么：
  - 启用 WSL + 虚拟机平台功能，Docker Desktop 正常运行（server 29.6.2）
  - 起一次性测试库容器 `ai-image-test-db`（postgres:17，端口 5433）
  - 配好 `.env.test`（7 个变量，含 `DATABASE_DRIVER=pg` 和
    `DISPOSABLE_TEST_DB_DRIVER=pg` 两个易漏开关，缺它们会去连云服务）
  - `npm run db:test:migrate` → 8 份迁移全部应用 🟢
  - `npm run test:money` → **17 文件 84 用例全绿** 🟢（扣费/FIFO/负余额/
    幂等/custom 零扣费/凭据销毁/不回退 全部真库验证通过）
  - `npm run test:e2e` → 3 轮运行均为"1-2 通过 + 1 偶发超时"：key-modes
    用例依赖浏览器轮询节奏，在本机 Windows dev 服务器下不稳定，失败点在
    轮次间漂移，非确定性产品缺陷（对应业务逻辑已被 money 真库套件覆盖）
- 验收证据：上述命令输出已逐条核对
- 提交记录：本条目随文档更新一并提交
- 遗留问题：
  1. e2e 轮询偶发超时——判定规则已写入 VERIFY.md（重跑确认；同一断言
     连续三次失败才按缺陷处理）；如需彻底稳定，建议后续在 CI/Linux 跑 e2e
  2. Node 24 vs engines 要求 22 的警告仍在
  3. 测试容器 `ai-image-test-db` 常驻本机 Docker，关机后需 `docker start
     ai-image-test-db` 恢复
- 下一步建议：环境验收全部收口，可进入第一个功能优化任务（走 tasks/
  任务卡流程）

### [2026-07-24] 基线验收会话（体检）
- 任务来源：owner 要求执行基线验收
- 完成了什么：
  - 环境：Node v24.15.0（注意：package.json engines 要求 >=22 <23，实测可跑，未阻塞；建议后续装 Node 22 对齐）；`npm install` 378 包成功
  - `npm run typecheck` → 退出码 0 🟢
  - `npm run test:run` → 54 个测试文件、453 通过 / 1 跳过，0 失败，退出码 0 🟢（覆盖登录表单、对话编辑、管理后台、系统更新等）
  - `npm run test:money` → 🔴 未能执行：17 个文件全部因"缺少 .env.test（一次性 PostgreSQL 测试库）"在加载阶段失败，0 条用例实际运行；本机无 Docker/PostgreSQL
- 验收证据：上述命令输出已核对，money 套件失败为环境前置缺失而非代码缺陷
- 提交记录：本条目随文档修正一并提交
- 遗留问题：
  1. 资金链路（F-031/F-033 等）本地无法复验，需在有数据库的环境（CI/服务器）补跑 `test:money`
  2. e2e（`test:e2e`）同样依赖数据库环境，本轮未跑
  3. Node 版本与 engines 声明不一致，仅是警告但建议对齐
- 下一步建议：在服务器或装好 Docker 后补跑 money + e2e 两盏红灯；之后进入正常功能迭代循环

### [2026-07-24] 协作文档框架接管
- 任务来源：owner 要求建立 AI 协作文档框架
- 完成了什么：新建 FEATURES.md / VERIFY.md / WORKFLOW.md / tasks 模板；CLAUDE.md 增补 SOP、验收命令、Git 纪律三节；本文件改造为固定交接格式
- 验收证据：文档类改动，无需跑测试
- 提交记录：待提交
- 遗留问题：FEATURES.md 各条目状态基于历史文档盘点，首次实际跑验收时需逐条复核
- 下一步建议：开一个"基线验收会话"，跑通 VERIFY.md 全部绿灯命令

---

## 历史基线记录（2026-07-14 及以前，格式从旧，仅作存档）

# 当前状态

更新：2026-07-14。生产基线仍为 `0.2.0`；`v0.2.1` 已发布但首次后台更新暴露宿主机请求校验缺陷，尚未进入备份或迁移。`v0.2.2` 修复候选已完成实现，等待最终门禁、发布和一次性宿主更新器恢复。

| 里程碑 | 状态 | 证据 |
|---|---|---|
| 对话式生图与资产 | 已实现 | 登录会话、历史、资产库、灵感库和本地持久化媒体 |
| 积分与后台运营 | 已实现 | 成功后扣费、FIFO 批次、兑换码、套餐、审计和管理后台 |
| system/custom Key 模式 | 已实现 | 统一任务状态机；custom 每任务加密且本站零扣费 |
| 对话结果图文字二次编辑 | `v0.2.1` 已发布（待部署） | 当前对话成功卡入口、Composer 编辑态、来源关系、worker storage 回读和原有计费规则 |
| 单机全自托管 | 已部署 | Debian Docker Compose、PostgreSQL 17、本地媒体和持久卷 |
| 安装、备份与恢复 | 已实现 | 三项可见输入、内部密钥自动生成、校验和与七份普通备份保留 |
| 部署 CI | 已实现 | 脚本契约、构建元数据、空栈安装和持久化 smoke |
| 管理后台稳定版更新 | `v0.2.2` 修复待发布 | 检查/启动页面、隔离控制目录、systemd 更新器、恢复边界、真实请求校验回归和 Release CI |
| 腾讯云生产环境 | 已验证 | 容器运行、Web/PostgreSQL 健康、内外网 `/healthz` 均为 `204` |

## 当前线上实例

- 站点：[https://one-image2.tangguo.xin](https://one-image2.tangguo.xin)
- 管理员入口：[https://one-image2.tangguo.xin/admin/login](https://one-image2.tangguo.xin/admin/login)
- 系统更新入口：[https://one-image2.tangguo.xin/admin/system-update](https://one-image2.tangguo.xin/admin/system-update)
- 产品版本：`0.2.0`
- 生产提交：`c5131aaa0335250a3846c380519324fbbf4b231b`
- 入口链路：Nginx -> `127.0.0.1:18080` -> React Router SSR `web`
- 运行服务：`postgres`、`web`、`worker`、`scheduler`
- TLS：已启用并配置自动续期
- Key 配置：`CUSTOM_KEY_MODES_ENABLED=true`，custom 加密密钥已配置

## 2026-07-14 `v0.2.1` 发布（生产待更新）

- 版本：`0.2.1` / tag `v0.2.1`；发布工作流验证通过后成为 stable/latest Release。
- 计划提交：`02b9ca5`
- 契约/迁移：`9cd2c26`
- 入队权限：`da348af`
- worker/storage/计费：`e502196`
- 会话与状态来源摘要：`7021ce4`
- 乐观提交来源：`c7e12a4`
- Composer 编辑态与结果来源 UI：`627c8c9`
- 审查修复（跨会话草稿、来源错误卡、并发删除锁序）：`8ba1dd6`
- 完整聚焦门禁：单元/UI 11 文件 77 用例、真库 6 文件 41 用例全通过；typecheck、生产 build、秘密扫描退出 0。
- 审查后定向回归：前端/Hook 2 文件 9 用例、完整 enqueue 文件 13 用例全通过；typecheck 再次退出 0。
- 范围边界：没有新增生成端点、队列、编辑服务或价格；没有资产库/灵感库入口、画笔、蒙版、扩图或独立编辑器。
- 部署边界：`v0.2.1` 发布不等于生产更新；线上仍是下方“当前生产验证”记录的 `0.2.0` / `c5131aa`，由管理员后台确认后执行更新。

## 2026-07-14 `v0.2.2` 更新器校验热修复（发布候选）

- 生产请求 `26e972ea-37e0-4361-8d03-52130c1c241b` 在 `202` 后始终停留于公开 `idle`；systemd service 每 20 秒退出重试，但站点保持 `0.2.0` 健康。
- 请求与预约 JSON、UUID、时间、权限和单链接均合法；首次失败发生时预约仍有 15 分钟有效期，且没有进入备份、Git checkout、迁移或停站。
- 根因：宿主脚本使用 `jq --stream -e` 逐事件统计顶层键，数组长度永远不能达到 4，导致所有合法请求在发布 `claiming` 前被拒绝。
- 修复：请求与预约校验使用 slurp 聚合全部流事件，同时保留重复键和严格 schema 拒绝；新增真实 `process-request` Shell 回归并纳入 `test:deploy`。
- 后台：浏览器已有 `202` 请求 ID 而宿主仍为 `idle` 时，明确显示“更新请求已提交，等待主机更新器接收”，不再只禁用按钮而无状态。
- TDD 证据：Shell 回归修复前失败于“合法请求未发布状态”、修复后通过；后台 UI 修复前找不到等待状态、修复后 1/1 通过。
- 生产边界：发布 `v0.2.2` 后只引导安装经 tag 校验的宿主更新器入口，清理精确匹配的过期请求，再从管理员后台重新启动原有守护更新流程。

## 2026-07-13 部署证据

- 升级前备份：`deploy/backups/20260713T145807Z`
- 备份校验：`database.dump`、`media.tar.gz`、`manifest.env` 全部通过 SHA-256 校验
- 容器：`postgres`、`web`、`worker`、`scheduler` 均运行；Web 与 PostgreSQL 为 healthy
- 健康检查：`http://127.0.0.1:18080/healthz` 和公开 `/healthz` 均返回 `204`
- 版本固化：Web 容器内 `APP_VERSION=0.2.0`，`APP_COMMIT_SHA` 与生产提交一致
- 后台入口：未登录访问 `/admin/system-update` 返回 `302` 到登录流程
- 更新器：`ai-image-workshop-update.path` 为 enabled/active，`ai-image-workshop-update.service` 为 enabled
- 工作树：生产仓库无未提交修改

## 发布与部署边界

`v0.2.1` tag 指向 `main` 中的精确发布提交。`v0.2.2` 也必须在 CI 验证版本、tag、提交归属、完整质量门和 Docker 空栈 smoke 后，才创建新的 stable/latest GitHub Release。后台更新器只接受严格递增的稳定版，不读取功能分支。

`v0.2.2` 发布完成后生产仍保持 `0.2.0`，直到一次性恢复宿主更新器并由管理员在 `/admin/system-update` 重新启动更新。更新器会先排空任务、备份，再构建、应用兼容迁移并健康检查；该生产结果必须在更新完成后另行记录。

## 持续运维与发布动作

以下是需要按发布或运维周期执行的动作，不代表产品功能未实现：

- 完成 `v0.2.2` 宿主更新器一次性恢复，在管理员后台执行 `0.2.0 -> 0.2.2`，并记录备份 ID、提交、容器和健康检查证据。
- 使用真实第三方 Relay 周期性检查 system/custom 的 t2i/i2i、单终态、扣费和凭据清理。
- 定期验证历史 `/media/*` 在应用容器重建后仍可读取。
- 定期执行生产备份恢复到新空卷的演练，并记录恢复时间。
- 轮换管理员凭据、撤销旧会话并复查审计记录。
- 接入长期监控、告警和加密异地备份。

## 可选增强

- 把仍复用的 `netlify/functions` handler 移到平台无关目录；Docker 运行时已经不依赖 Netlify。
- 根据真实 CPU、内存、队列、Relay 和存储指标决定 worker 扩容。
- 多机高可用和自动异地备份不属于当前单机部署基线。

部署、升级、发布和故障恢复只看 [Docker 部署与运维](dev/deploy.md)；自动与人工验收范围见 [运维与验证](dev/10-ops-test.md)。
