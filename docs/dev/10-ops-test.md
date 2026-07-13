# 运维与验证

状态：现有 `0.2.0` 功能、部署脚本契约、Docker 镜像构建和空数据 Compose 持久化 smoke 均已实现。真实 system/custom Relay 生图按生产运维周期检查。

## 当前生产验证

2026-07-13 已验证腾讯云生产提交 `c5131aaa0335250a3846c380519324fbbf4b231b`：升级前备份为 `deploy/backups/20260713T145807Z`；四个服务均运行，Web/PostgreSQL healthy；内网与公网 `/healthz` 均返回 `204`；更新 `.path` 为 enabled/active，service 为 enabled；未登录访问 `/admin/system-update` 返回 `302`。这些结果证明本次部署基础健康，不替代真实 Relay 和恢复演练的周期性执行。

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

`test:deploy` 覆盖安装输入、resume、升级、备份和恢复命令契约。`test:deploy:smoke` 会真正启动空 PostgreSQL 栈，执行 `0000` 至 `0007` 迁移、创建管理员、确认 custom 已开放且自动生成的密钥可完成 AES-GCM 往返、占用宿主机 `3000` 验证无冲突、写入媒体、重建应用容器并确认图片仍可读取，最后清理测试资源。

金额/锁测试另在一次性 PostgreSQL 中运行 `npm run test:money`，必须保留 `FOR UPDATE`、回滚、幂等和并发语义。

### 对话结果图编辑专项

本需求的最终验证只覆盖相关契约、handler、storage/failure、状态读取、生成 hook、对话编辑 UI，以及 disposable PostgreSQL 中的 enqueue/system/custom pipeline/deadline：

```bash
npm run test:run -- src/contracts/generate.test.ts src/contracts/public-media-url.test.ts tests/unit/generate-handler.test.ts tests/unit/generate-status-handler.test.ts src/server/generation/failure.test.ts src/server/r2.server.local.test.ts src/server/generation/status.server.test.ts src/lib/generationBatch.test.ts src/hooks/useGeneration.test.tsx src/components/conversation/ConversationView.imageEdit.test.tsx src/components/conversation/ConversationView.keyModes.test.tsx
npm run test:money -- tests/money/enqueue.test.ts tests/money/enqueue-custom.test.ts tests/money/pipeline.test.ts tests/money/pipeline-custom.test.ts tests/money/timeout.test.ts tests/money/deadline.test.ts
npm run typecheck
npm run build
npm run assert-no-secrets
```

自动验收必须证明：来源 UUID 与临时上传互斥；伪造/越权/未成功/跨对话来源零写入；worker 只从服务端 storage key 读取；system 成功恰一条 debit，失败/超时/来源不可用零 debit；custom 成功余额/批次/账本不变；编辑态错误保留且 `202` 后才关闭；结果来源展示和重试/连续编辑保留关系。真实 Relay、腾讯云部署、GitHub Release 和 `main` 合并不属于本次本地验收。

2026-07-14 本地结果：完整聚焦门禁中，单元/UI 为 11 个文件、77 个用例全通过，disposable PostgreSQL 为 6 个文件、41 个用例全通过，`typecheck`、生产 `build` 和 `assert-no-secrets` 均退出 0。最终审查修复后又定向运行前端/Hook 2 个文件 9 个用例、完整 enqueue 文件 13 个用例，均通过；随后 `typecheck` 再次退出 0。构建仅出现既有 Vite `envFile` 弃用与 plugin timing 警告，无错误。该结果不代表腾讯云已部署或真实 Relay 已验收。

## 服务器验收基线与周期性检查

| 项目 | 通过条件 |
|---|---|
| 空数据安装 | 只输入 Relay Key、管理员邮箱和可见密码；迁移和 seed 自动完成 |
| 管理员 | `/admin/login` 可登录，业务 `users` 与 Better Auth `user` 都为 admin |
| 真实 Relay | system 生成恰好一个终态、一张图片、最多一次 debit；日志无 Key |
| 用户 custom | 普通用户可保存自己的 Key，零本站余额也能生图；无 debit、终态删除临时凭据 |
| 本地媒体 | `/media/*` 可读，重建 web/worker/scheduler 后仍可读 |
| 备份恢复演练 | 备份校验通过；恢复到新空卷后 DB、图片和 `/healthz` 正常 |
| 端口隔离 | 宿主机 `3000` 已占用仍可安装，宿主机不发布 `5432` |
| 系统更新 | 后台能检查官方稳定版；维护时阻止新写入；成功后版本/提交与 tag 一致 |
| 更新恢复 | 迁移前故障自动回滚；迁移后只允许精确请求 ID 的数据库恢复命令 |

## 系统更新演练

1. 确认 `systemctl status ai-image-workshop-update.path` 正常，Web 无 Docker socket 挂载。
2. 在 `/admin/system-update` 检查更新并记录请求 ID、旧版本和备份 ID。
3. 更新过程中确认新写请求返回维护响应，已有 generation 先收口，状态按阶段推进。
4. 成功后确认 `/healthz=204`、页面版本和容器 `APP_COMMIT_SHA` 对应发布 tag。
5. 在隔离环境分别模拟迁移前失败和迁移后失败；前者应自动回滚，后者应保留 pin/rollback/checkpoint，并只接受页面给出的 `recover REQUEST_ID`。

## 备份恢复演练

1. 运行 `sudo bash deploy/backup.sh` 并记录输出目录。
2. 在隔离项目或维护窗口准备停止且为空的目标卷。
3. 运行 `sudo bash deploy/restore.sh <备份目录>`，输入要求的确认串。
4. 验证管理员、关键表行数、历史图片和 `/healthz=204`。

不要把“备份命令成功”当作恢复可用；至少定期完成一次实际恢复演练。本地备份不能抵御整机或磁盘损坏，异地副本是后续运维项。

紧急关闭 custom 时，缺失/`false` 会让新提交返回 `503` 且零写入。关闭入口后应等待 worker 收口在途任务，或使用受审计的 `fail-custom-generations` 流程；`generation_credentials` 清零前不得轮换加密主密钥。

## 容量与秘密

首发保持 `WORKER_CONCURRENCY=1` 和单 scheduler。根据 CPU、内存、队列等待、Relay 时长/失败率、数据库连接数和媒体增长量再扩 worker；PostgreSQL polling 未成为瓶颈前不增加队列系统。

构建产物、日志、Sentry、告警、events、audit 和 API 响应不得包含 system/custom 明文 Key。发现泄漏时在仓库外轮换凭据并吊销相关会话。
