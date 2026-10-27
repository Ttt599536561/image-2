# Backend Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce site-controlled queue and result latency for ten concurrent image jobs while preserving durable images, authentication and charging rules.

**Architecture:** Keep PostgreSQL as authoritative durable queue. Run a bounded continuously replenished worker; transactional notifications wake idle consumers and authenticated SSE clients, with scans/polling as recovery. Return committed image metadata directly to the conversation cache and reduce redundant read queries.

**Tech Stack:** Node 22, React Router 8, PostgreSQL 17, pg, React Query, Vitest and Playwright.

User confirmed GitHub version and implementation on 2026-10-27. Worktree: `E:/iamge2生图项目工作区/.local/performance-worktree`, branch `codex/backend-performance`. No remote push or deployment in this phase. Previous setup/comparison documentation is preserved.

## Shared contract and ownership

- Worker owner: `worker.server.ts`, `process.ts`, `money/preempt.server.ts`, `r2.server.ts`, `local-storage.server.ts`, relevant tests and isolated fake-job performance checks.
- Notification owner: new `generation/notifications.server.ts`, SSE route, `status.server.ts`, generate contracts, generation status hook, ConversationView and tests; migration `0010_generation_notifications.sql` and schema queue index.
- Read owner: reads/projects services, sidebar and queries hook, app loader, image list route, dashboard and corresponding tests.
- Root: integration, pool settings/diagnostics, test environment/runner, deploy concurrency settings, final regression and hosting investigation. Root alone edits shared task/progress/feature documents and commits.
- Notification API: `subscribeGenerationChanges(listener: (change: { generationId: string; userId: string }) => void): () => void`. Lazy shared pg Client; no-op when non-pg; unsubscribe releases idle listener. Notify only IDs; callers re-read owner-scoped authoritative data. Worker uses this to wake; its timed scan remains sufficient on failure.

## Task 1 — Baseline and isolated validation

- [x] Install from reused npm cache, run `npm run typecheck` and `npm run test:run`; record exit codes and baseline counts.
- [x] Create a distinct local database `image2_performance_test`, `.env.test` disposable acknowledgement, random local-only auth/encryption keys. Never copy development database URL into test target.
- [x] Preserve original worker implementation as benchmark reference inside an isolated test harness; use deferred jobs/fixed synthetic delay, no paid Relay requests.

## Task 2 — Continuous queue processing and bounded I/O

- [x] Write red tests for late arrivals while earlier job remains pending, immediate slot refill, concurrency cap, claim collision, database error backoff, cancellation listener cleanup and graceful drain. Example assertion: resolve job A while B remains deferred; C must have started before B is resolved.
- [x] Add atomic oldest eligible claim using `WITH next AS (SELECT id FROM generations WHERE status='queued' AND deadline_at>now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE generations ... FROM next ... RETURNING ...`. Only execute a successfully claimed record, and keep by-ID entry guarded. Never hold a transaction while awaiting Relay.
- [x] Implement active-promise-set scheduling that rescans while capacity remains, wakes on completion/notification, and bounds error retries. Rejected individual jobs cannot tear down the scheduler; shutdown stops claims and awaits started jobs.
- [x] Write red tests for aborted URL downloads/storage uploads and cleanup/metrics failures. Propagate an AbortSignal with remaining deadline through storage; preserve image persistence before successful settlement and no late terminal overwrite.
- [x] Add non-secret per-phase timing; retain custom cleanup and no billing/credential behavior changes. Run focused tests and money tests before integration.

## Task 3 — Commit notifications and immediate results

- [x] Write red tests for lazy one-per-process listener, reconnect, last-unsubscribe cleanup, and non-pg fallback.
- [x] Add PostgreSQL trigger migration that calls `pg_notify` on inserted jobs/status changes; delivery follows transaction commit. Payload contains generation/user IDs only. Listener reconnects with bounded delay and subscribers reread snapshots; never treat NOTIFY as durable state.
- [x] Write SSE tests for initial snapshot, authenticated owner scope, heartbeat, disconnect cleanup, bounded connection lifetime, terminal result, fallback and reconnect. Register `/api/generate-events` in route table. Response uses `text/event-stream`, no cache/transform and no buffering; no gzip-held event delivery.
- [x] Add committed image `id` and `savedToLibrary` to status contracts and queries. Red-test immediate cache merge without waiting for detail fetch and no stale pending overwrite.
- [x] Status hook uses EventSource when active, batch polling during connection failure, and reconnect snapshot. Never cancel generation when browser disconnects. Client cache merges only owned, known jobs and retains optimistic submissions.
- [x] Run focused unit/route/component tests and E2E with no real provider calls.

## Task 4 — Read path efficiency

- [x] Red-test no default legacy conversation query when sidebar search is empty; preserve search and optimistic updates. Remove default loader query and enable search query only when needed.
- [x] Consolidate loadMe into one round trip preserving immediate price visibility and bigint handling. Test missing user, empty expiry and configured/fallback price.
- [x] Replace single-project full reload with scoped project/conversation reads. Replace per-item sorting UPDATE with parameterized UNNEST/ordinality SQL, preserving exact-set/owner checks and transaction rollback.
- [x] Validate asset pagination using finite positive integer checks and pageSize<=100, invalid values return 400. Test Infinity/negative/fractional/too-large inputs.
- [x] Restrict dashboard active queue aggregation before counting. Root adds verified notification index; avoid speculative indexes or changing financial aggregation semantics.

## Task 5 — Pool capacity, runtime and integration

- [x] Test environment-configured bounded read/transaction/auth pool sizes (default four unchanged) and a configurable 10-second connection acquisition ceiling to fail explicitly instead of waiting indefinitely during database failure. This ceiling is a reliability policy, not a measured speed improvement. Add optional sanitized acquisition/query timing; no credentials/SQL parameter logging.
- [x] Configure target single-worker concurrency 10 consistently in runtime/templates/installer. Document per-process meaning, upstream limit dependence, shutdown grace and single scheduler; preserve existing production files.
- [x] Make test web port derived from validated loopback test URL so E2E uses a separate port; update runner tests and retain the 8888 default.
- [x] Apply migration to disposable test database and inspect EXPLAIN with representative fixtures. Add general notifications(user_id,created_at DESC) index in separate migration `0011_read_performance.sql` if confirmed.
- [x] Run typecheck, unit, money, E2E, build, no-secret bundle assertions, deploy tests if scripts changed. Inspect failures at their source, compare pre-existing issues where necessary.
- [x] Review spec compliance then correctness/quality independently; fix findings and rerun affected validation. Record before/after fake-provider timing and exact limits of inference.
- [x] Commit accepted implementation on feature branch, integrate into main local working directory while preserving earlier docs, migrate local development DB, restart local web/worker/scheduler and verify browser. Implemented in cce3c75; main typecheck exit 0, healthz 204, browser form interactive.

## Task 6 — Free deployment recommendation after code validation

- [x] Read current official hosting documentation for free compute, databases, persistent storage, background jobs, sleep, bandwidth and outbound limits. Separate recurring free allowances from trial credits.
- [x] Compare candidates against this exact architecture (Node server + resident worker/scheduler + Postgres + media). Explain that hosting cannot eliminate provider generation time.
- [x] Deliver verified recommendation and deployment requirements; do not create accounts, accept paid plans or overwrite existing production during research.
