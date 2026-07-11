# User API Key Modes Implementation Record

Status: local implementation complete; Docker production rollout pending.

## Completed

- [x] Unified system/custom generation through `POST /api/generate` and one
  generation state machine.
- [x] Added user-scoped browser Key configuration, generation-scoped AES-GCM
  server credentials, terminal cleanup, deadline handling, and feature kill
  switch.
- [x] Added custom zero-credit finalization, multi-task status tracking, owner
  scoping, rollback containment, and admin visibility.
- [x] Verified the local implementation with typecheck, build, secret scan,
  unit tests `188/188`, money tests `74/74`, and Key-mode E2E evidence.

## Still Required

- [ ] Rotate production administrator credentials and revoke sessions.
- [ ] Run the Docker migration/dark rollout with
  `CUSTOM_KEY_MODES_ENABLED=false`.
- [ ] Verify system production behavior, custom `503` zero-write behavior, then
  controlled custom t2i/i2i behavior and rollback containment before enabling
  custom mode.

The product contract is [prd-user-api-key-modes.md](../../../tasks/prd-user-api-key-modes.md).
Current rollout truth is [PROGRESS.md](../../PROGRESS.md). Historical detailed
micro-task evidence remains available in Git history.
