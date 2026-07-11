# Debian Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Netlify with a Docker Compose deployment on Debian.

**Architecture:** React Router is served by Node. A private worker consumes the existing PostgreSQL-backed generation state machine, and a singleton scheduler runs maintenance. Caddy is the only public container.

**Tech Stack:** Node 22, React Router 8, TypeScript, PostgreSQL/Neon, Docker Compose, Caddy, Vitest.

---

### Task 1: Persistent database pools

**Files:** Modify `src/db/db.server.ts`, `src/server/tx.server.ts`; create `src/db/db.server.test.ts`.

- [ ] Write failing tests proving `getPool()` returns the same pool in persistent mode and `tx()` releases, but does not end, that pool.
- [ ] Run `npm run test:run -- src/db/db.server.test.ts`; expected failure: a new pool is created and ended for every transaction.
- [ ] Implement a module-scoped transaction pool plus `closeDbPools()`. Keep `BEGIN`, `COMMIT`, rollback, and `FOR UPDATE` behavior unchanged; make `tx()` call only `client.release()`.
- [ ] Run the focused test; expected PASS.
- [ ] Commit: `git add src/db/db.server.ts src/server/tx.server.ts src/db/db.server.test.ts && git commit -m "fix: reuse database pools in persistent processes"`.

### Task 2: Platform-neutral HTTP handlers

**Files:** Create `src/server/generation/http.server.ts`; modify `app/routes/api.generate.ts`, `app/routes/api.generate-status.ts`, `app/routes.ts`; update generation unit tests; delete `netlify/functions/generate.ts`, `netlify/functions/generate-status.ts`, `netlify/functions/generate-background.ts`, and route `api/generate-background`.

- [ ] Move the existing generate/status request logic into `handleGenerate(request)` and `handleGenerateStatus(request)` exports.
- [ ] Write tests that a valid `POST /api/generate` returns `202` after `enqueueGeneration` and does not make an HTTP background request.
- [ ] Run `npm run test:run -- tests/unit/generate-handler.test.ts tests/unit/generate-status-handler.test.ts`; expected failure before the extraction, PASS after it.
- [ ] Preserve user validation, custom-key kill switch, error mapping, and all generation record semantics.
- [ ] Commit the handler extraction after focused tests pass.

### Task 3: Private generation worker

**Files:** Create `src/server/generation/worker.server.ts`, `scripts/worker.ts`, and worker tests; modify `src/server/generation/scan.server.ts`, `package.json`; delete `src/server/generation/trigger.ts` and its tests.

- [ ] Write failing tests for `runWorkerIteration({ concurrency })`, asserting it selects only queued, unexpired IDs and invokes `runGenerationJob` no more than the configured concurrency.
- [ ] Implement polling with a 500 ms idle delay. `runGenerationJob` must retain the existing atomic claim and remain the sole executor. The worker installs `SIGTERM`/`SIGINT` abort handling, waits for in-flight jobs, then calls `closeDbPools()`.
- [ ] Change stale-queue scan to recovery-only status work; it must not issue requests to an internal/public background endpoint.
- [ ] Add `start:worker` as `node --import tsx scripts/worker.ts` and `WORKER_CONCURRENCY` validation.
- [ ] Run `npm run test:run -- src/server/generation/worker.server.test.ts tests/money/enqueue.test.ts tests/money/pipeline.test.ts`; expected PASS. Commit worker changes.

### Task 4: Singleton maintenance scheduler

**Files:** Create `src/server/scheduler/jobs.server.ts`, `scripts/scheduler.ts`, and tests; delete all `netlify/functions/cron-*.ts`; modify `package.json`.

- [ ] Extract each existing cron body into named services. Preserve alert/Sentry calls, timeout rescan, credential cleanup, budget cleanup at 16:00 UTC, expiry at 16:10, reconciliation at 16:30, and image cleanup at 17:00.
- [ ] Write failing tests for `runDueJobs(now)` covering per-minute timeout work, five-minute credential cleanup, daily cadence, and failure isolation.
- [ ] Implement a one-second scheduler loop that records each completed slot, preventing duplicate work within one process.
- [ ] Add `start:scheduler` as `node --import tsx scripts/scheduler.ts` and graceful shutdown using `closeDbPools()`.
- [ ] Run scheduler tests and the moved credential cleanup test; expected PASS. Commit scheduler changes.

### Task 5: Node SSR server, health, and proxy trust

**Files:** Add `server/index.ts`, `app/routes/healthz.ts`, tests; modify `vite.config.ts`, `package.json`, `src/server/rateLimit.ts`, `app/routes.ts`; delete `netlify.config.test.ts`.

- [ ] Write failing tests for `GET /healthz` returning `204` after `SELECT 1`, otherwise `503`, and for forwarded client IPs being honored only when `TRUST_PROXY=true`.
- [ ] Replace the Netlify Vite plugin with the React Router Node serving path. Add `start:web` to serve `build/server/index.js` and static `build/client` assets on `HOST`/`PORT`.
- [ ] Do not retain Netlify headers or URLs. Keep the normal React Router resource routes unchanged.
- [ ] Run `npm run test:run -- app/routes/healthz.test.ts src/server/rateLimit.test.ts && npm run typecheck && npm run build`; expected PASS. Commit web-runtime changes.

### Task 6: Docker Compose assets

**Files:** Add `Dockerfile`, `.dockerignore`, `compose.yaml`, `deploy/Caddyfile`, `deploy/.env.production.example`, `deploy/compose.test.yaml`, and Compose tests; modify `package.json`.

- [ ] Write tests that Compose exposes only Caddy on `80:80`/`443:443`, has one scheduler, private web/worker/scheduler services, restart policies, and a web health check.
- [ ] Build a non-root Node 22 multi-stage image. It must run `npm ci`, `npm run build`, then copy only production runtime files and dependencies.
- [ ] Define `web`, `worker`, and `scheduler` using the same image with `start:web`, `start:worker`, and `start:scheduler`; Caddy reverse-proxies to `web:3000` and persists certificate data.
- [ ] Add `engines.node: ">=22 <23"` and `docker:validate` (`docker compose config`). Production env must set `TRUST_PROXY=true`, `WORKER_CONCURRENCY=1`, and leave all secrets blank.
- [ ] Run `npm run test:run -- tests/deploy/compose-config.test.ts && npm run docker:validate && docker compose build`; expected PASS. Commit deployment assets.

### Task 7: Documentation, Netlify removal, and release verification

**Files:** Modify `docs/dev/deploy.md`, `docs/dev/01-architecture.md`, `.env.example`; delete `netlify.toml`, `netlify/`, Netlify-only dependencies and scripts.

- [ ] Replace the Netlify runbook with Debian setup, Docker Engine/Compose installation, DNS/Caddy certificate prerequisites, environment installation, migration, rollout, smoke checks, logs, backup ownership, and image-tag rollback.
- [ ] Document that the first production rollout requires `CUSTOM_KEY_MODES_ENABLED=false` until controlled smoke validation succeeds.
- [ ] Run `npm run typecheck && npm run test:run && npm run test:money && npm run build && npm run assert-no-secrets && npm run docker:validate && docker compose -f compose.yaml -f deploy/compose.test.yaml up --build --wait`.
- [ ] Verify `/healthz` succeeds and unauthenticated `/api/me` returns `401`; tear down the test stack with `docker compose -f compose.yaml -f deploy/compose.test.yaml down --volumes --remove-orphans`.
- [ ] Commit the documentation and Netlify removal.

## Plan Self-Review

- Each approved runtime component is implemented and tested by Tasks 1-6.
- Task 7 covers migration, observability, controlled rollout, and removal of the old platform.
- The plan retains PostgreSQL as the queue and does not introduce Redis/BullMQ, self-hosted PostgreSQL, or storage migration.
