# 项目上下文

## 当前事实

这是一个对话式 AI 生图应用：system 模式只在图片成功落存储后扣本站积分；图片进入会话和资产库；后台管理配置、运营与审计。

- 当前分支：`codex/user-api-key-modes`。HEAD 已包含 Key 模式和 Debian Docker 运行时（`75485f3`、`ab9894d`、`837d2fb`）。
- 目标生产运行时：Docker Compose，包含 Caddy、SSR `web`、生成 `worker` 与单例 `scheduler`；Neon Postgres 和 Supabase S3 继续作为外部服务。
- 旧 Netlify 站点只是迁移前生产基线。Docker 生产迁移、联网主机镜像构建和生产 smoke 尚未执行，因此不得称 custom Key 已上线。
- 最近本地证据：类型检查、构建、秘密扫描、Compose 配置、单元测试 `188/188`、金额测试 `74/74`，以及 Node SSR `/healthz=204`、未登录 `/api/me=401`。

## 首次发布门禁

1. 轮换管理员密码并吊销现有会话；任何文档、日志、提交或消息不得记录凭据。
2. 备份生产数据库，配置 `deploy/.env.production`，按 [deploy.md](docs/dev/deploy.md) 执行受确认保护的迁移。
3. 在 Debian 主机构建并启动 Compose；验证 health、system 生图、存储、扣费、worker/scheduler 日志和秘密脱敏。
4. 首发保持 `CUSTOM_KEY_MODES_ENABLED=false`；验证 custom 请求为 `503` 且零写入，再用受控 t2i/i2i smoke 和回滚演练确认后才启用。

## 不可违反规则

- 金额使用整数毫积分；system 仅成功后扣费；`generation_id` 幂等；FIFO 扣费；余额不得为负。
- `generations` 是队列和状态真相源。worker 原子抢占，scheduler 处理超时和维护；不要恢复公开后台执行端点或浏览器直连 relay。
- system/custom 共用 `/api/generate`、状态机、relay、存储和状态 API。custom 不触碰本站积分、账本、预算和 system 并发，也不得静默回退 system。
- custom Key 是受控例外：浏览器 localStorage 加 HTTPS 请求体；服务端仅任务级 AES-GCM 密文并在终态删除。明文不得进入普通表、events、audit、日志、Sentry 或响应。
- 管理员页面和 API 均需管理员守卫；敏感写需确认和同事务审计。生成不可取消。

## 文档入口

- [PROGRESS.md](docs/PROGRESS.md)：当前状态与待发布清单。
- [prd-user-api-key-modes.md](tasks/prd-user-api-key-modes.md)：产品契约，不承担状态。
- [deploy.md](docs/dev/deploy.md)：Debian/Docker 发布手册。
- [docs/dev/README.md](docs/dev/README.md)：技术设计索引。
- [Docker 设计记录](docs/superpowers/specs/2026-07-11-debian-docker-deployment-design.md)。

历史 Phase 计划、Netlify 发布记录和详细微任务只用于回归调查；当前接手只看本文件、`PROGRESS.md` 与部署手册。
