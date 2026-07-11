# 当前状态

更新：2026-07-11。

## 已完成

- [x] Key 模式本地实现：统一 system/custom 生成 API、任务级加密凭据、批量状态读取、5 分钟 deadline、custom 零扣费、回滚收口、UI 与后台记录。
- [x] Debian Docker 实现：Node SSR `web`、PostgreSQL 队列 `worker`、单例 `scheduler`、Caddy、health、受确认迁移、Compose 和生产环境模板。
- [x] 本地验证：类型检查、构建、秘密扫描、Compose 配置、单元测试 `188/188`、金额测试 `74/74`、Node SSR health/auth smoke。
- [x] 依赖收敛：移除未使用的 Netlify/Better Auth CLI 工具链，Vite 升级到 `8.1.4`，high/critical 审计通过并加入 CI。

## 尚未完成

- [ ] 在可访问镜像仓库的 Debian 主机实际构建镜像并启动 Compose。当前本机 Docker build 在拉取基础镜像授权前被网络阻断，未执行到项目构建层。
- [ ] Docker 生产切换。旧 Netlify 站点仅是历史基线，生产 custom Key 尚未启用。

## 发布清单

- [ ] 轮换管理员密码并吊销会话。
- [ ] 备份生产 PostgreSQL 和对象存储。
- [ ] 从 `deploy/.env.production.example` 创建 `deploy/.env.production`，填写域名、数据库、认证、存储、relay、加密密钥，并设 `TRUST_PROXY=true`、`WORKER_CONCURRENCY=1`。
- [ ] 在 Debian 执行 Compose build 与受确认迁移。
- [ ] 启动服务，确认 `/healthz=204`，检查 web/worker/scheduler/Caddy 日志。
- [ ] 保持 `CUSTOM_KEY_MODES_ENABLED=false`，验证 system 全链路和 custom `503` 零写入。
- [ ] 用受控账号完成 custom t2i/i2i、零扣费、终态删凭据和日志脱敏验证，再启用 custom。
- [ ] 演练回滚：先关闭 custom，执行受审计收口脚本，确认无在途 custom 任务或凭据。

## 后续可选项

- [ ] 将 `netlify/functions` 中被路由和 scheduler 复用的 handler 抽到平台无关模块并重命名目录，再删除兼容触发 helper；Netlify CLI、Vite adapter、Blobs 依赖与平台配置已移除，这不是 Docker 首发阻塞项。
- [ ] 增加 scheduler 时刻表测试和 Compose 全链路集成 smoke；现有证据覆盖调度 helper 与本地 Node SSR，不等于容器内完整生成验收。
- [ ] 增加 Better Auth 孤儿账号定时扫描或受控运维检查；当前只有注册 after-hook 和下次登录补发，从不再次登录的极端孤儿不会被 scheduler 主动修复。
- [ ] 配置 `SENTRY_DSN` 与 `ADMIN_ALERT_WEBHOOK`。
- [ ] 为 CI 建立隔离 Neon 测试分支。
- [ ] 升级 `pg` v9 / `pg-connection-string` v3 前验证所有 Neon 连接串显式使用 `sslmode=verify-full`；当前测试仅有前瞻警告，无失败。
- [ ] 跟踪 Drizzle Kit 旧 esbuild loader 的 4 个中危开发期告警；当前无 high/critical，禁止用会降级 Drizzle Kit 的 `npm audit fix --force`。
- [ ] 协同升级 React Router 8.0.1；Vite 8.1.4 构建已通过，但上游插件仍输出 `envFile` 弃用提示。
- [ ] 量化 Docker 主机、relay、数据库和存储成本后再提升生成量或改价。
- [ ] 仅在 PostgreSQL 队列吞吐实测不足时评估 Redis/Valkey + BullMQ。

历史 Phase、UGC、Netlify 发布和微任务证据保留在 Git 与 `docs/superpowers/`，不再作为当前状态入口。
