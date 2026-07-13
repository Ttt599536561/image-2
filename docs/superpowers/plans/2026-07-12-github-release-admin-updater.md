# GitHub Release Admin Updater Implementation Record

Status: completed in `0.2.0` and bootstrapped on the Tencent Cloud production host on 2026-07-13.

## Goal Reached

Administrators have a protected `/admin/system-update` page that checks the fixed official GitHub repository for a higher stable Release and delegates accepted upgrades to a constrained root-owned Debian updater. Application containers never receive Docker socket, project-root or host-shell access.

## Delivered

- [x] Added strict shared system-update contracts, SemVer comparison and build metadata validation.
- [x] Added the fixed-repository GitHub Release client with draft/prerelease, version, tag and commit validation.
- [x] Added atomic request/status state, maintenance middleware, reservation ownership and restart-safe polling.
- [x] Added admin-authenticated, same-origin JSON check/start routes with audit-before-request ordering.
- [x] Added the responsive admin page, confirmation flow, disconnected/recovery states and navigation entry.
- [x] Added Web-only inbox/state mounts; worker and scheduler have no updater mounts.
- [x] Added `deploy/ai-image-workshop-update` with exact Release preflight, shared locking, drain, backup, build, migration, restart, rollback and recovery boundaries.
- [x] Added pin-aware backup retention and exact-request `status`/`recover` commands.
- [x] Added and installed `ai-image-workshop-update.path` and `.service` systemd units.
- [x] Added `scripts/validate-release.ts` and tag-gated stable/latest Release publication rules in GitHub Actions.
- [x] Added focused Web, state, security, updater and deployment contract coverage.

## Final Artifacts

- `app/routes/_admin.system-update.tsx`
- `app/routes/api.admin.system-update.ts`
- `app/routes/api.admin.system-update.check.ts`
- `src/contracts/system-update.ts`
- `src/server/system-update/`
- `deploy/ai-image-workshop-update`
- `deploy/systemd/ai-image-workshop-update.path`
- `deploy/systemd/ai-image-workshop-update.service.in`
- `scripts/validate-release.ts`
- `.github/workflows/ci.yml`

## Production Evidence

- Production version/commit: `0.2.0` / `c5131aaa0335250a3846c380519324fbbf4b231b`
- Bootstrap backup: `deploy/backups/20260713T145807Z`, checksums passed
- New Web image carries the exact version and commit
- `ai-image-workshop-update.path`: enabled and active
- `ai-image-workshop-update.service`: enabled
- Sanitized updater state: idle at current version `0.2.0`
- Local and public health: `204`
- Unauthenticated admin update route: `302` to login

## Publication Boundary

The release workflow is implemented, but GitHub `main`, the `v0.2.0` tag and a stable/latest `v0.2.0` Release have not been published. The current server was bootstrapped from `codex/admin-system-updater`. After that branch is merged and `0.2.0` is published as the baseline, the first normal one-click update must be a strictly higher stable version.

## Ongoing Operations

- Protect published tags against update/deletion and keep Release assets immutable.
- Exercise higher-version success, pre-migration rollback and post-migration recovery on an isolated host.
- Run real-provider and restore checks during release maintenance windows.
- Monitor backup capacity and updater status without exposing control files to application containers.

The approved design is [2026-07-12-github-release-admin-updater-design.md](../specs/2026-07-12-github-release-admin-updater-design.md). Current commands are in [deploy.md](../../dev/deploy.md), and production truth is [PROGRESS.md](../../PROGRESS.md).
