# 运维与验证

状态：Docker runtime 已实现；生产运行和 Compose smoke 尚未完成。

## Scheduler

Docker `scheduler` 进程以 UTC 调用维护 handler：

| 时间 | 任务 |
|---|---|
| 每分钟 | generation deadline rescan |
| 每 5 分钟 | 过期 custom credential 清理 |
| 16:00 | budget cleanup |
| 16:10 | credit expiration |
| 16:30 | balance reconciliation |
| 17:00 | image/orphan cleanup |

每个 handler 必须保持幂等、失败告警和数据库时钟语义。一个 scheduler 进程是当前
部署约束；不要同时运行 Netlify scheduled functions 与 Docker scheduler。

## Health And Logs

`GET /healthz` 检查数据库连接和当前 generation/credential schema。Compose 用它
决定 web 健康，worker、scheduler 与 Caddy 等待 web healthy 后启动。

```bash
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=200 web worker scheduler caddy
curl -fsS -o /dev/null https://<domain>/healthz
```

## Required Checks

```bash
npm run typecheck
npm run test:run
npm run test:money
npm run build
npm run assert-no-secrets
npm run docker:validate
npm audit --audit-level=high
```

High/critical audit is a CI gate. Four moderate development-only advisories remain
under Drizzle Kit's legacy esbuild loader; do not use `npm audit fix --force`,
because its proposed fix downgrades Drizzle Kit to an incompatible release.

Production smoke must additionally prove one system generation reaches exactly
one terminal state, one stored image, and at most one debit. With custom disabled,
custom requests must return `503` and create neither generation nor credential.
Before enabling custom mode, test t2i/i2i zero-site-debit behavior, terminal
credential deletion, redacted logs/audits, and containment rollback.

## Cost And Capacity

Track system and custom separately. System cost includes Docker host resources,
relay usage, database, and object storage; custom has zero site-credit revenue but
still consumes host/database/storage resources. Establish host CPU/memory,
worker queue latency, relay duration/failure rate, database connection count, and
storage/egress baselines before raising concurrency or pricing volume.

Keep `WORKER_CONCURRENCY=1` and one scheduler for first release. Scale workers
only after measuring atomic claim behavior and relay capacity. Evaluate Redis or
BullMQ only when PostgreSQL queue throughput is demonstrably inadequate.

## Secrets

`npm run assert-no-secrets` scans client build output. Production logs, Sentry,
alerts, events, audits, normal tables, and API responses must not contain system
or custom plaintext Keys. Rotate leaked credentials outside the repository and
revoke active sessions as part of first release.
