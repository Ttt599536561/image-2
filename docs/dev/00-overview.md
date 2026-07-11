# 运行时与配置

状态：Docker 运行时已实现并通过本地静态验证；生产切换尚未执行。

## 运行拓扑

| 组件 | 职责 | 对外暴露 |
|---|---|---|
| Caddy | TLS、反向代理、静态资源缓存 | 80/443 |
| `web` | React Router SSR、页面、认证和 REST API | 仅 Compose 网络 |
| `worker` | 轮询并原子领取 `generations`，运行长时生图 | 仅 Compose 网络 |
| `scheduler` | 超时、凭据、预算、积分、对账和图片清理 | 仅 Compose 网络 |
| Neon Postgres | 账号、账本、队列、审计和状态真相源 | 外部托管 |
| Supabase Storage | S3 兼容对象存储和稳定公开 URL | 外部托管 |

启动命令在 `package.json`：`start:web`、`start:worker`、`start:scheduler`。
生产配置和命令见 [deploy.md](deploy.md)。`netlify/` 目录仍保存可被
路由和 scheduler 复用的历史 handler；Docker 不依赖 Netlify 平台运行它们。

## 数据库调用

- `DATABASE_URL`：Neon pooled/HTTP 查询，用于只读聚合和单语句原子操作。
- `DATABASE_URL_UNPOOLED`：Pool/WebSocket 事务，用于 FIFO 扣费、兑换、调账和
  其他 `FOR UPDATE` 路径。
- 事务 pool 在进程内复用；worker 和 scheduler 在 SIGTERM/SIGINT 时通过
  `closeDbPools()` 关闭。`react-router-serve` web 与 Better Auth 独立 pool 由服务进程
  生命周期管理。disposable `pg` 测试环境保留隔离 pool 语义。

任何多语句的读-改-写金额逻辑必须走事务 pool；不要把 HTTP 单语句客户端用于
`FOR UPDATE` 或跨语句事务。

## 环境变量

生产模板是 [`deploy/.env.production.example`](../../deploy/.env.production.example)。
生产文件必须为 gitignored 的 `deploy/.env.production`，不可写入镜像或仓库。

| 分组 | 必需变量 |
|---|---|
| 域名/代理 | `DOMAIN`、`BETTER_AUTH_URL`、`TRUST_PROXY=true` |
| 数据库 | `DATABASE_URL`、`DATABASE_URL_UNPOOLED` |
| 鉴权 | `BETTER_AUTH_SECRET` |
| 存储 | 全部 `STORAGE_*` 变量 |
| 中转 | `RELAY_API_KEY`、`RELAY_BASE_URL` |
| custom Key | `CUSTOM_KEY_JOB_ENCRYPTION_KEY`、`CUSTOM_KEY_MODES_ENABLED` |
| Worker | `WORKER_CONCURRENCY=1`（首次上线） |

可选观测变量为 `SENTRY_DSN` 和 `ADMIN_ALERT_WEBHOOK`。任何包含密钥或连接串的
变量不得使用 `VITE_` 前缀。`npm run assert-no-secrets` 会扫描构建产物。

## 安全边界

- system Key、数据库、存储与鉴权秘密只在服务端使用。
- custom Key 是产品明确接受的例外：浏览器按用户保存明文，经 HTTPS 提交；服务端
  只保存任务级 AES-GCM 密文，并在终态删除。
- 所有 relay 错误、日志、事件、审计、Sentry 和 API 响应必须脱敏实际 Key。
- `CUSTOM_KEY_MODES_ENABLED` 缺失或为 false 时必须返回 `503` 且零写入，不能
  静默改走 system。

## 发布前验证

```bash
npm run typecheck
npm run test:run
npm run test:money
npm run build
npm run assert-no-secrets
npm run docker:validate
```

这些命令只证明本地实现。生产 migration、Compose build、health 和受控生图 smoke
按 [deploy.md](deploy.md) 执行。
