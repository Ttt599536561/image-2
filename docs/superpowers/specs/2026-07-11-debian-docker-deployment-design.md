# Debian Docker Deployment Design

## Goal

Run the application on a Debian server with Docker Compose, removing Netlify as
the application runtime while preserving current PostgreSQL data, S3-compatible
storage, authentication, generation state-machine, money semantics, and custom
credential cleanup behavior.

## Scope

The first migration keeps Neon Postgres, Supabase Storage, and the existing AI
relay. It replaces Netlify SSR adaptation, Background Functions, Scheduled
Functions, and redirect configuration with standard Node processes.

## Runtime Topology

```text
Internet -> Caddy (TLS and reverse proxy) -> web (React Router SSR and HTTP API)
                                          -> worker (generation execution)
                                          -> scheduler (recurring maintenance)
web/worker/scheduler -> Neon Postgres, Supabase S3, AI relay
```

All application processes use the same image and environment file. Their
commands select a single responsibility:

- `web` runs the React Router Node server and serves all SSR and public HTTP
  endpoints.
- `worker` atomically claims queued generation rows and invokes
  `runGenerationJob`. It is the only process that performs long-running image
  generation.
- `scheduler` runs the existing maintenance operations on their current
  schedules: timeout rescan, credential cleanup, budget cleanup, credit expiry,
  balance reconciliation, and image cleanup.
- `caddy` terminates TLS and proxies only to `web`; worker and scheduler have no
  public ports.

## Application Changes

1. Replace the Netlify Vite adapter with the React Router Node adapter and add a
   Node server entrypoint.
2. Move request handlers currently owned by `netlify/functions` into server
   modules so route resources and the Node process use the same implementation.
3. Replace `triggerBackground` with durable wake-up behavior. The HTTP submit
   endpoint enqueues only; the worker continuously polls/claims eligible rows.
   Scheduler timeout rescan remains a recovery path, not the primary dispatcher.
4. Expose no internal generation execution endpoint in production. The existing
   test-only route may remain guarded by `DISPOSABLE_TEST_DB_DRIVER`.
5. Move each scheduled-function body into a callable cron service. Scheduler
   runs those services at the existing UTC schedules and logs failures; a failed
   run exits nonzero only after logging/capture has occurred.

## Data and Correctness

`generations` remains the queue and the authoritative status record. Worker
claiming must retain the existing atomic state transitions, `deadline_at`
enforcement, idempotent success/debit behavior, and terminal credential deletion.
No Redis or queue broker is introduced in this migration. This keeps the data
model stable and avoids a dual-source queue during cutover.

Only one scheduler replica is started. Web and worker may be scaled after the
single-worker deployment has been verified because generation claims are already
atomic. Caddy is the only published service; database credentials, storage
credentials, relay secrets, and encryption keys are provided at runtime and are
never copied into images or committed files.

## Docker and Operations

The repository will include:

- A multi-stage `Dockerfile` that builds React Router output and runs Node in
  production mode.
- `compose.yaml` defining Caddy, web, worker, and scheduler with restart
  policies, health checks, read-only source-free runtime images, and a private
  service network.
- A Caddy configuration for HTTPS and websocket-safe reverse proxying.
- An environment template containing every required production variable but no
  secret values.
- Debian deployment documentation covering initial host setup, environment-file
  installation, schema migration, rollout, smoke checks, log inspection,
  rollback, backup ownership, and upgrades.

## Failure Handling

- If `web` restarts after enqueueing a generation, the worker sees the durable
  queued row.
- If a worker crashes, its claimed/running job is closed by the existing timeout
  rescan using database time; it is never charged unless the existing successful
  terminal transaction completes.
- If scheduler is down, recurring cleanup is delayed but no request handler
  silently performs the maintenance work. Compose restart policy restores it.
- Caddy keeps the application process private and supplies TLS; failures are
  observable with `docker compose logs` and container health checks.

## Validation

Before release, run type checking, unit suites, money suites, production build,
secret bundle assertion, and compose image build. Start the Compose stack with a
disposable test configuration, verify SSR login and unauthenticated API behavior,
then run a controlled generation and confirm terminal state, storage output, and
unchanged billing semantics.

## Non-goals and Next Step

This migration does not move Neon to self-hosted PostgreSQL, replace Supabase
Storage, introduce Redis/BullMQ, or change AI providers. Once the Docker runtime
is stable, Redis/BullMQ can be evaluated if sustained generation volume or queue
latency exceeds what PostgreSQL claiming can support. PostgreSQL pooling should
be configured separately with Neon pooled URLs where the current production
connection settings do not already do so.
