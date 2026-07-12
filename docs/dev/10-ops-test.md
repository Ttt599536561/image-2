# 运维与验证

状态：部署脚本契约、Docker 镜像构建和空数据 Compose 持久化 smoke 已进入 CI。真实 Relay Key 的生图验收必须在目标服务器执行。

## Scheduler

| UTC 时间 | 任务 |
|---|---|
| 每分钟 | generation deadline 重扫 |
| 每 5 分钟 | 过期 custom credential 清理 |
| 16:00 | budget cleanup |
| 16:10 | credit expiration |
| 16:30 | balance reconciliation |
| 17:00 | image/orphan cleanup |

每个 handler 必须幂等、按数据库时钟判断并在失败时告警。生产只运行一个 scheduler 副本。

## Health 与日志

`GET /healthz` 检查数据库连接和当前 generation/credential schema。Compose 以它判断 Web 健康，worker、scheduler 和 Caddy 等待 Web healthy。

```bash
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=100 web worker scheduler postgres
curl -fsS -o /dev/null -w '%{http_code}\n' https://<domain>/healthz
```

预期 HTTP 状态为 `204`。

## 自动化门禁

```bash
npm run typecheck
npm run test:run
npm run build
npm run assert-no-secrets
npm run docker:validate
npm run test:deploy
npm run test:deploy:smoke
```

`test:deploy` 覆盖安装输入、resume、升级、备份和恢复命令契约。`test:deploy:smoke` 会真正启动空 PostgreSQL 栈，执行 `0000` 至 `0006` 迁移、创建管理员、占用宿主机 `3000` 验证无冲突、写入媒体、重建应用容器并确认图片仍可读取，最后清理测试容器、卷和临时配置。

金额/锁测试另在一次性 PostgreSQL 中运行 `npm run test:money`，必须保留 `FOR UPDATE`、回滚、幂等和并发语义。

## 服务器验收

| 项目 | 通过条件 |
|---|---|
| 空数据安装 | 只输入 Relay Key、管理员邮箱和可见密码；迁移和 seed 自动完成 |
| 管理员 | `/admin/login` 可登录，业务 `users` 与 Better Auth `user` 都为 admin |
| 真实 Relay | system 生成恰好一个终态、一张图片、最多一次 debit；日志无 Key |
| 本地媒体 | `/media/*` 可读，重建 web/worker/scheduler 后仍可读 |
| custom | 零本站扣费，终态删除临时凭据，不回退 system |
| 备份恢复演练 | 备份校验通过；恢复到新空卷后 DB、图片和 `/healthz` 正常 |
| 端口隔离 | 宿主机 `3000` 已占用仍可安装，宿主机不发布 `5432` |

## 备份恢复演练

1. 运行 `sudo bash deploy/backup.sh` 并记录输出目录。
2. 在隔离项目或维护窗口准备停止且为空的目标卷。
3. 运行 `sudo bash deploy/restore.sh <备份目录>`，输入要求的确认串。
4. 验证管理员、关键表行数、历史图片和 `/healthz=204`。

不要把“备份命令成功”当作恢复可用；至少定期完成一次实际恢复演练。本地备份不能抵御整机或磁盘损坏，异地副本是后续运维项。

## 容量与秘密

首发保持 `WORKER_CONCURRENCY=1` 和单 scheduler。根据 CPU、内存、队列等待、Relay 时长/失败率、数据库连接数和媒体增长量再扩 worker；PostgreSQL polling 未成为瓶颈前不增加队列系统。

构建产物、日志、Sentry、告警、events、audit 和 API 响应不得包含 system/custom 明文 Key。发现泄漏时在仓库外轮换凭据并吊销相关会话。
