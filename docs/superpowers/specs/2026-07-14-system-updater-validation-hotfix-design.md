# System Updater Request Validation Hotfix Design

Date: 2026-07-14
Status: Implemented; release and production recovery pending

## Incident

Production `0.2.0` accepted update request
`26e972ea-37e0-4361-8d03-52130c1c241b` with HTTP `202`, but the host updater
never moved beyond the public `idle` state. The systemd service exited with status 1
and restarted every 20 seconds. The application stayed healthy on `0.2.0`; no backup,
migration, service stop, or Git checkout occurred.

The request and reservation files were valid, matched each other, had the expected
ownership and mode, and were still within the 15-minute lease when the first failure
occurred. Running the updater's exact request key check against the production file
returned `validator_exit=1`.

## Root Cause

`validate_request_json` and `validate_reservation` use `jq --stream -e` to detect
duplicate top-level keys. Without slurp mode, jq evaluates the filter once for each
stream event. The local `$keys` array therefore contains at most one key, so the
required length of four can never be reached. Every valid request is rejected before
the updater publishes `claiming`.

The browser stores the request ID after `202` and keeps polling, but the progress band
only renders active or terminal host phases. A stored request paired with host `idle`
therefore disables the controls without displaying any progress or diagnostic state.

## Considered Approaches

1. Hot-patch only the installed production script and update to `v0.2.1`. This is
   fastest, but leaves GitHub without the fix and repeats the defect on the next host.
2. Publish `v0.2.2`, bootstrap only the verified updater script on the host, then use
   the normal guarded update pipeline. This preserves release provenance, backup,
   migration, health-check, rollback, and future self-update behavior. This is the
   approved approach.
3. Bypass the updater and manually deploy the entire Git tree and Compose stack. This
   has the largest production blast radius and bypasses the controls the updater was
   built to provide.

## Code Changes

- Aggregate jq stream events with `--slurp` for both request and reservation duplicate
  key checks while retaining the existing strict schema checks.
- Add a shell regression test that runs the real updater in test mode with a valid
  request and reservation, then proves the request reaches a published terminal state.
- Include the new shell test in `npm run test:deploy` so release CI cannot recreate the
  bug.
- Render an explicit "request accepted, waiting for host updater" progress state when
  the browser has a stored request ID but the host still reports `idle` or another
  request. Keep polling and keep the request ID visible.
- Add a focused UI test for the accepted-but-idle state.

No update protocol, endpoint, privilege boundary, billing logic, database schema, or
image-edit behavior changes in this hotfix.

## Release And Recovery

1. Bump package and lockfile versions to `0.2.2` and update only the updater/release
   status documentation.
2. Run one focused final gate covering the updater regression, admin update UI, release
   validation, typecheck, build, secret scan, and Compose validation.
3. Commit and push the feature branch and `main`, create annotated tag `v0.2.2`, and
   wait for the GitHub Actions Release workflow to publish a stable Latest Release.
4. On production, stop the updater path/service loop, verify the stuck request identity
   and idle `0.2.0` state again, and preserve a copy of the installed updater.
5. Fetch the exact `v0.2.2` tag from the official repository, verify its package version
   and commit, extract only `deploy/ai-image-workshop-update`, and install it at the
   fixed root-owned updater path.
6. Remove only the verified expired request and matching reservation token, initialize
   idle state with the repaired updater, and re-enable the path unit.
7. Start a new update through the authenticated admin UI so audit and request security
   remain intact. Monitor host state through completion.

## Acceptance

- A valid four-field request is claimed instead of rejected.
- Duplicate or malformed request/reservation JSON remains rejected.
- After `202`, the admin page never becomes silently disabled while host status is
  still `idle`.
- `v0.2.2` is published only after all release gates pass.
- Production reports `completed`, `currentVersion: 0.2.2`, and `maintenance: false`.
- Public `/healthz` returns 204, the deployed frontend contains the conversation image
  edit source contract and edit action, and existing data remains available.
