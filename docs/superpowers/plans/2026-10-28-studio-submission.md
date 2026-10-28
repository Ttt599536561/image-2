# Immediate studio submission implementation plan

> For agentic workers: implement the bounded tasks in the shared isolated worktree and review before merging.

**Goal:** Show a submitted task immediately while reference uploads and generation submission continue in the background; repair the upload timeout causing proxy 502s.

**Architecture:** Preserve the existing server queue and request contracts. Represent local preparation in browser history metadata, keep frozen credentials/files in memory, and transition the same generationId to the server queue. Hide upload implementation details from normal UI, preserve failure/retry and reload behavior.

**Tech stack:** React hooks, TypeScript, IndexedDB, Vitest, Playwright, React Router, PostgreSQL.

## Tasks

- [x] `src/server/studio/api.server.ts` and its tests: pass `120_000` only to the uploads `readLimitedBody` call; test delayed real multipart streams with a virtual deadline clock, retain JSON and size limits.
- [x] `src/lib/studio/useStudio.ts`, `history.ts`, their tests and studio task components: create local task before awaited network I/O, keep incomplete requests out of replay/polling, freeze retry inputs, preserve failed cards and interrupted-reload handling. First demonstrate tests failing against the old flow, then implement.
- [x] `tests/e2e/studio.spec.ts`: hold upload route until task visibility is asserted, then continue real upload and complete through fake relay. Assert a failed upload remains visible and retry cannot omit images. Adapt existing fixtures only where the authorized immediate-submission flow changes expectations.
- [x] Run `npm run typecheck`, `npm run test:run`, `npm run test:e2e`, `npm run build`, `npm run assert-no-secrets` and `npm audit --audit-level=high` with E-drive Node/cache and an exclusive disposable database. Review diff independently.
- [x] Commit and publish through the existing server deployment flow, preserve rollback image/backup, repeat the 922428-byte slow upload, verify public health and immediate-task browser behavior, update `docs/PROGRESS.md` and F-079 status.
