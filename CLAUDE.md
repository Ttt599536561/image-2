# 项目上下文

这是一个无需普通用户账户的 AI 生图工作台。服务URL固定为 `https://api.tangguo.xin/v1`，用户只填写自己的API Key，选择 `gpt-image-2.5-sunburst` 或 `gpt-image-2`（默认）；所有公开生图均为custom。最多4张有序参考图。站内套餐、积分、注册和普通登录已退役，历史与图片副本保存在当前浏览器。

## 当前生产事实

- 当前代码版本为 `0.3.1`；部署主机为 `45.207.199.3` 的 `/opt/ai-image-workshop`，
  站点为 `https://one-image2.tangguo.xin`。实际运行提交和最新验收以 `docs/PROGRESS.md` 为准。
  按owner确认使用全新数据库，未迁移旧账号/积分/图片；旧腾讯云站点保留作回退。
- Debian Docker Compose：Caddy/现有代理 -> `web`，并运行 `worker`、单例 `scheduler`。
- PostgreSQL 17 在私有 Compose 网络中，数据卷为 `postgres_data`；宿主机不发布 `5432`。
- 媒体默认存 `media_data:/app/data/media`，数据库保存相对地址 `/media/<key>`。
- 容器内 Web 使用 `3000`；宿主机已有 `3000` 不冲突。现有代理模式只绑定空闲的 `127.0.0.1` 端口。
- 安装从空数据开始，不迁移 Neon/Supabase/Netlify 数据。Neon 与 S3 仅是可选驱动。
- 管理员入口 `/admin/login`，仅用于 `/admin/system-update` 运维；普通用户不用账户。安装器兼容保留的站长Relay Key不参与新工作台生成，用户填写固定服务的Key。
- 安装、resume、升级、备份、恢复及空栈持久化 smoke 已实现并验证；现有产品与工程需求全部收口。
- `/` 直接展示三栏工作台；旧welcome/login/register/billing/account页面跳回工作台。旧公开账户、充值、套餐及生成API不注册，源码与测试归档在 `legacy/routes`。
- 管理后台更新入口为 `/admin/system-update`；宿主机
  `ai-image-workshop-update.path` 已启用并运行，Web 不持有 Docker 或 shell 权限。
- GitHub `main` 与 stable/latest Release 是更新器唯一更新来源；最新发布版本需实时核实，
  2026-07-25 已完成首次全链路受控更新（`0.2.0` → `0.2.7`，含 jq 1.6 校验、
  DOCKER_CONFIG、UMask 三项宿主环境修复）。真实 Relay 检查、恢复演练、
  凭据轮换和异地备份按持续运维周期执行。

## 不可破坏

- 历史计费表保留供回退，新匿名流程不得创建/修改余额、批次、账本或预算；管理员认证也不发积分。不得以删除旧表完成普通功能退役。
- `generations` 是队列和状态真相源；worker 原子抢占，scheduler 处理超时和维护。
- 匿名owner必须由高熵HttpOnly cookie映射，不能接受客户端ownerId。任务、上传、SSE与图片严格校验归属，用户媒体经Web输出private缓存。
- 固定URL＋Key以任务级AES-GCM密封、终态删除；禁止system回退。禁止请求覆盖固定URL，也不可把旧异域保存的Key自动改投固定服务。上游及返回图片URL仍走安全HTTPS出站，校验全部DNS并固定连接IP，禁止私网及redirect。
- 模型和所有参考图按任务冻结；四图逐一校验owner、顺序和上限。旧单图可读，来源字段不混用。每图4MiB，出站multipart最多16MiB＋64KiB，默认其它请求5MiB上限不放宽。
- `generation_id`重放不能重复调用上游；owner在途10/全局100原子闸，单worker并发10。POST同源校验与由代理覆盖的IP限流不可移除。
- 管理员页面/API 必须有 admin guard；敏感写入同事务审计。
- 所有业务 Compose 命令使用 `--env-file deploy/.env.production`；不得删除数据卷处理普通启动故障。

## 会话开始 SOP

每次新会话开始，必须先按顺序执行，再谈任务：

1. 读 `docs/PROGRESS.md` 顶部"当前状态速览"和最新一条日志。
2. 读 `docs/FEATURES.md` 中与本任务相关的条目。
3. 跑 `git log --oneline -10` 看最近提交。
4. 跑 `npm run typecheck`，确认基线是绿的；不绿先修基线，不做新任务。

## 完工验收命令

改完代码必须自己跑命令验收，通过标准与汇报格式见
[验收红绿灯](docs/VERIFY.md)。最低门槛：`npm run typecheck` +
`npm run test:run` 全绿；动到钱加跑 `npm run test:money`，动到页面
加跑 `npm run test:e2e`。不许口头说"通过了"，必须贴命令输出证据。

## Git 纪律

- 一条功能验收全绿后立即提交一次，提交信息格式：
  `feat|fix: [<FEATURES.md 编号>] <一句话说明>`。
- 提交前工作区不许留无关改动；一次提交只做一件事。
- 翻车了用 `docs/WORKFLOW.md` 第五节的救命卡回滚，不许蛮干。

## 入口

- [部署手册](docs/dev/deploy.md)
- [当前状态](docs/PROGRESS.md)
- [技术索引](docs/dev/README.md)
- [产品契约](tasks/prd-user-api-key-modes.md)

当前改造见 `tasks/2026-10-28-studio-refinement.md`；匿名基线见 `tasks/2026-10-28-anonymous-studio.md`。旧账户/营销/计费规格仅用于回归及回退，不应恢复其公开入口。
