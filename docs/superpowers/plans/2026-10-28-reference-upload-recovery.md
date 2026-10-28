# Reference upload recovery implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development; perform test-first implementation and independent review.

**Goal:** Preserve screenshot bytes and recover interrupted uploads without duplicate generation.
**Architecture:** Owner-scoped PG upload sessions with 64KiB chunks; bounded browser retries; stable final storage key and completion receipt. Existing multipart endpoint remains compatible.
**Tech Stack:** TypeScript, React Router, PostgreSQL, Vitest, Playwright.

## Shared protocol

`POST /api/studio/uploads/resumable` JSON `{uploadId, size, mime, sha256}` → `{uploadId, chunkSize:65536, nextIndex, expiresAt, inputImageKey?}`.
`PUT /api/studio/uploads/resumable/:id/:index` raw application/octet-stream → `{nextIndex}`; same bytes at same index are idempotent, conflicting bytes 409.
`POST /api/studio/uploads/resumable/:id/complete` no request payload → `{inputImageKey}`; completion is idempotent.

Creation freezes UUID, size, mime, hash and destination key; cookie determines owner. TTL10min; limits4/owner,8/IP,40/global with capacity including uncleared expired chunks. Fixed-size chunks except last; maximum64. Three attempts total with abortable deadlines and bounded Retry-After. Completion uses receiving/finalizing/complete state and stable key verified on recovery.

## Tasks and checks

- [ ] Backend: add protocol constants/contracts in `src/contracts/studio-upload.ts`, migration0014, session/chunk service and API routes, per-chunk rate limits, stable storage completion and scheduler cleanup. Tests first for replay/conflict/owner/expiry/quota, response loss and storage-before-DB crash. Run unit suite plus a disposable PG integration suite.
- [ ] Client: add `src/lib/studio/resumable-upload.ts`; replace uploadReference transport while preserving its signature, file validation and useStudio order. Stable uploadId/hash state retained per File only in memory. Tests first for each lost response, timeout, 429, rejected4xx, SHA integrity, completion retry, expired session restart and no unbounded loops.
- [ ] Integration: update E2E upload mocks to the new protocol, add actual screenshot-paste upload with interrupted chunk response and exactly one generation, four ordered inputs, cross-owner denial and full4MiB integrity.
- [ ] Verification: typecheck, fullunit, full E2E, PG integration, build, secrets scan, npm audit and independent specification/code review. Fix any reproduced defect before commit.
- [ ] Publish authorized repair after validation: version0.3.3, docs/FEATURES and PROGRESS, GitHub CI, controlled deployment with backup/migration, actual valid synthetic public uploads and SHA equality. Do not use a real paid generation Key. Cleanup created disposable data/probes/worktree after integration, retain validation summaries.

Existing source instructions in CLAUDE.md and accepted spec `docs/superpowers/specs/2026-10-28-reference-upload-recovery.md` remain authoritative. All command caches/builds/tests on E. Shared implementation worktree; file ownership is partitioned among agents and final integration handled by root.
