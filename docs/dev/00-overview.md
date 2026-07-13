# 运行时与配置

状态：`0.2.0` 单机全自托管运行时、安装/恢复脚本、空栈持久化 smoke 和管理后台更新器均已实现并部署。真实 Relay 检查按运维周期执行，不是未实现功能。

## 生产基线

2026-07-13，腾讯云生产环境升级到提交 `c5131aaa0335250a3846c380519324fbbf4b231b`。升级备份为 `deploy/backups/20260713T145807Z`；`postgres`、`web`、`worker`、`scheduler` 均运行，内网与公网 `/healthz` 均返回 `204`。`ai-image-workshop-update.path` 已启用且 active，更新 service 已启用。完整证据见 [PROGRESS.md](../PROGRESS.md)。

## 运行拓扑

| 组件 | 职责 | 数据/端口 |
|---|---|---|
| Caddy 或现有代理 | TLS、反向代理、媒体缓存 | Caddy 模式发布 `80/443` |
| `web` | React Router SSR、认证和 REST API | 容器内 `3000`；宿主机仅绑定自动选择的回环端口 |
| `worker` | 原子领取 `generations` 并执行生图 | PostgreSQL + `media_data` |
| `scheduler` | 超时、凭据、预算、积分、对账和图片清理 | PostgreSQL + `media_data`，单副本 |
| `postgres` | 账号、账本、队列、审计和状态真相源 | `postgres_data`，不发布宿主机 `5432` |
| `media_data` | 生成图、上传图和灵感图 | 共享命名卷，容器路径 `/app/data/media` |
| 宿主机更新器 | 校验官方 Release、备份、构建、迁移、回滚/恢复 | root systemd oneshot；固定控制目录，不暴露给 worker/scheduler |

启动命令在 `package.json`：`start:web`、`start:worker`、`start:scheduler`。仓库中的 `netlify/functions` 只是过渡期 handler 源码，Docker 运行时不依赖 Netlify 平台。

## 数据库与存储驱动

- 自托管生产使用 `DATABASE_DRIVER=pg`。`DATABASE_URL` 和 `DATABASE_URL_UNPOOLED` 都指向 Compose 内部的 `postgres:5432`，读路径和事务路径分别复用标准 `pg` 连接池。
- `getPool()` 用于 `BEGIN`、`FOR UPDATE` 和多语句读改写；`getSql()` 用于只读或单语句操作。所有金额路径必须保持事务边界。
- 自托管生产使用 `STORAGE_DRIVER=local` 和 `LOCAL_STORAGE_ROOT=/app/data/media`。数据库保存同源相对地址 `/media/<key>`。
- Neon 和 S3 兼容存储仍是可选驱动，不是单机部署依赖。

## 配置归属

`deploy/install.sh` 只询问 Relay Key、管理员邮箱和管理员密码，自动生成 PostgreSQL 密码、Better Auth 密钥和 custom Key 加密密钥，并写入 gitignored、权限为 `600` 的 `deploy/.env.production`。

业务 Compose 命令必须显式带：

```bash
docker compose --env-file deploy/.env.production ps
```

系统 Key、数据库连接串、认证密钥和存储凭据都只能在服务端使用，不得使用 `VITE_` 前缀。custom Key 是受控例外：浏览器按用户保存明文，经 HTTPS 提交，服务端只保留任务级 AES-GCM 密文并在终态删除。

当前一键自托管安装显式写入 `CUSTOM_KEY_MODES_ENABLED=true`，用户上线即可选择 custom；缺失或 `false` 仍作为紧急停止新 custom 提交的 fail-closed 开关。

镜像在运行阶段固化 `APP_VERSION` 与完整 `APP_COMMIT_SHA`，且构建值必须与 `package.json`/Git 一致。`web` 对 `/run/ai-image-workshop-updater/inbox` 只有请求写权限，对 `state` 只有读取权限；它没有 Docker socket、项目根目录或执行宿主机命令的能力。

## 核心验证

```bash
npm run typecheck
npm run test:run
npm run build
npm run assert-no-secrets
npm run docker:validate
npm run test:deploy
npm run test:deploy:smoke
```

服务器安装、登录、周期性真实 Relay 检查、备份和恢复步骤见 [deploy.md](deploy.md)，完整验收范围见 [10-ops-test.md](10-ops-test.md)。
