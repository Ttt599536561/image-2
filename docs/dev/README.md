# 技术设计索引

当前技术基线为 `0.2.0`，现有需求已经实现并部署。产品规则见 [redesign-requirements.md](../redesign-requirements.md)，生产与 Release 状态见 [PROGRESS.md](../PROGRESS.md)。本目录描述当前设计；已完成计划不再是工作队列。

## 当前运行时

当前生产运行时为 Debian Docker Compose：Caddy/现有代理 -> React Router SSR `web`；私有 `worker` 消费本机 PostgreSQL 的 `generations` 队列；单例 `scheduler` 跑维护任务；图片持久化到本机 `media_data`。root systemd 更新器独立处理后台发出的官方稳定版更新请求，Web 不持有 Docker 或宿主机 shell 权限。腾讯云生产环境运行提交 `c5131aa`；发布步骤只看 [deploy.md](deploy.md)。仓库中的 `netlify/` 是过渡兼容 handler 源码，Docker 运行时不依赖 Netlify 平台。

## 按需阅读

- [00-overview.md](00-overview.md)：运行时、环境变量与安全。
- [01-architecture.md](01-architecture.md)：拓扑与核心流程。
- [02-database.md](02-database.md)、[03-money.md](03-money.md)：schema、事务、积分和幂等。
- [04-generation-pipeline.md](04-generation-pipeline.md)：入队、worker、存储和 deadline。
- [05-auth.md](05-auth.md)、[06-storage.md](06-storage.md)、[07-api.md](07-api.md)、[08-frontend.md](08-frontend.md)、[09-admin.md](09-admin.md)：子系统契约。
- [10-ops-test.md](10-ops-test.md)：调度、观测与验证。
- [deploy.md](deploy.md)：Debian/Docker 上线。

## 契约与历史

- [Key 模式 PRD](../../tasks/prd-user-api-key-modes.md)：批准的产品契约。
- [Docker 设计记录](../superpowers/specs/2026-07-11-debian-docker-deployment-design.md)。
- `PHASE2-PLAN.md`、`PHASE3-PLAN.md`、UGC 计划和详细实施记录均为历史证据；不要以它们的 checkbox 判断当前状态。
