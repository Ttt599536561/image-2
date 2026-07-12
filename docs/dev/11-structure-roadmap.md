# 代码结构与演进

状态：单机 PostgreSQL、本地媒体、一键安装、备份恢复和部署 CI 均已完成；当前状态只看 [PROGRESS.md](../PROGRESS.md)。

## 当前结构

```text
app/                    React Router 页面与资源路由
src/contracts/          Zod 请求/响应契约
src/db/                 Drizzle schema 与连接驱动
src/server/             relay、存储、鉴权、金额和 generation 状态机
scripts/                worker、scheduler、迁移和受控运维脚本
drizzle/                受控 SQL 迁移
deploy/                 安装、备份、恢复、Caddy 与部署测试
compose.yaml            postgres/web/worker/scheduler/Caddy
Dockerfile              Node 22 多阶段生产镜像
netlify/                过渡期 handler 源码；运行时不依赖 Netlify 平台
```

## 不变边界

- `app/routes` 只适配 HTTP，业务逻辑放 `src/server`。
- `generations` 是队列和状态真相源，worker 是唯一长任务执行者。
- 金额、兑换和调账走 transaction pool + `FOR UPDATE`。
- 浏览器不得 value-import DB schema 或服务端秘密。
- web、worker、scheduler 共享应用镜像、PostgreSQL 和媒体卷；scheduler 保持单副本。

## 后续项

- 在真实 Debian 服务器完成 Relay 生图、管理员登录和恢复演练。
- 配置加密异地备份；多机高可用不属于当前单机首发范围。
- 将 `netlify/functions` 中仍复用的 handler 移入平台无关目录后删除历史命名。
- 只有实测 PostgreSQL polling 不足时才评估 Redis/Valkey + BullMQ。
- 根据运行指标配置 Sentry、告警、容量阈值和 worker 扩容。

已完成阶段和逐项 checkbox 保留在 Git 与 `docs/superpowers/`，不在本页重复维护。
