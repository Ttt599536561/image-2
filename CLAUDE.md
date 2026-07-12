# 项目上下文

这是一个对话式 AI 生图应用。system 模式只在图片成功持久化后扣本站积分；custom 模式使用用户 Key、本站零扣费且不回退 system。

## 当前生产事实

- Debian Docker Compose：Caddy/现有代理 -> `web`，并运行 `worker`、单例 `scheduler`。
- PostgreSQL 17 在私有 Compose 网络中，数据卷为 `postgres_data`；宿主机不发布 `5432`。
- 媒体默认存 `media_data:/app/data/media`，数据库保存相对地址 `/media/<key>`。
- 容器内 Web 使用 `3000`；宿主机已有 `3000` 不冲突。现有代理模式只绑定空闲的 `127.0.0.1` 端口。
- 安装从空数据开始，不迁移 Neon/Supabase/Netlify 数据。Neon 与 S3 仅是可选驱动。
- 安装器只收集 Relay Key、管理员邮箱、可见管理员密码；内部密钥自动生成。管理员入口 `/admin/login`。部署完成即开放 system/custom，用户可在浏览器保存自己的 Key。
- 安装、resume、升级、备份、恢复及空栈持久化 smoke 已实现并验证；真实 Relay 生图须在目标服务器验收。

## 不可破坏

- 金额使用整数毫积分；system 仅成功后扣费；`generation_id` 幂等；FIFO；余额不得为负。
- `generations` 是队列和状态真相源；worker 原子抢占，scheduler 处理超时和维护。
- custom 不碰账户、账本、预算或 system 并发；任务级 AES-GCM 密文在终态删除，明文不得进入日志、事件、审计或响应。
- 管理员页面/API 必须有 admin guard；敏感写入同事务审计。
- 所有业务 Compose 命令使用 `--env-file deploy/.env.production`；不得删除数据卷处理普通启动故障。

## 入口

- [部署手册](docs/dev/deploy.md)
- [当前状态](docs/PROGRESS.md)
- [技术索引](docs/dev/README.md)
- [产品契约](tasks/prd-user-api-key-modes.md)

已完成计划和历史平台记录只用于回归调查，不作为当前任务清单。
