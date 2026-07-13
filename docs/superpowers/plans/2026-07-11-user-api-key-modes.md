# User API Key Modes Implementation Record

Status: completed in `0.2.0` and deployed to Tencent Cloud on 2026-07-13.

## Delivered

- [x] Unified system/custom generation through `POST /api/generate` and one generation state machine.
- [x] Added browser user-scoped Key configuration and a fixed custom Base URL.
- [x] Added generation-scoped AES-GCM credentials, terminal cleanup, deadlines and a fail-closed feature switch.
- [x] Added custom zero-credit finalization, multi-task polling, owner scoping, rollback containment and admin visibility.
- [x] Preserved system balance, concurrency, budget and FIFO success-only debit semantics.
- [x] Enabled system/custom on a fresh production install without exposing plaintext Keys in logs, events, audit records or responses.

## Production Evidence

The `0.2.0` Web image contains the expected custom-mode configuration and encryption key format. The production stack migrated and restarted successfully at commit `c5131aa`; all four services run and `/healthz` returns `204` internally and publicly.

## Ongoing Operations

- Rotate production administrator credentials and revoke sessions on schedule.
- Recheck system/custom t2i/i2i with controlled third-party credentials for each release.
- Exercise the `503` zero-write kill switch, credential cleanup and rollback procedure during maintenance drills.
- Track separate system/custom provider, compute, database and storage costs.

The product contract is [prd-user-api-key-modes.md](../../../tasks/prd-user-api-key-modes.md). Current production truth is [PROGRESS.md](../../PROGRESS.md); detailed micro-task history remains available in Git.
