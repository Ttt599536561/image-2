# Self-Hosted One-Command Deployment Implementation Record

Status: completed and deployed on 2026-07-13.

## Goal Reached

A fresh Debian host can run the complete application with Docker Compose, local PostgreSQL, persistent local media, visible Relay/admin inputs, generated internal secrets, guarded upgrades and verified backup/restore artifacts.

## Delivered

- [x] Added explicit `pg` and `local` production drivers while retaining optional development-compatible drivers.
- [x] Added the same-origin `/media/*` route and persistent `media_data` ownership model.
- [x] Added private PostgreSQL 17, Web, worker, scheduler and optional Caddy services to `compose.yaml`.
- [x] Added a Node 22 multi-stage production image with fail-closed version and commit metadata.
- [x] Added `deploy/install-lib.sh` and `deploy/install.sh` for validation, three visible inputs, secret generation, administrator bootstrap, migrations, resume, upgrade and health checks.
- [x] Added `deploy/backup.sh` and `deploy/restore.sh` with PostgreSQL/media archives, SHA-256 validation, empty-target guards and retention.
- [x] Added deployment contract tests and a real empty-stack persistence smoke in CI.
- [x] Documented both bundled Caddy and existing reverse-proxy modes.

## Final Artifacts

- `Dockerfile`, `compose.yaml`, `deploy/Caddyfile`
- `deploy/.env.production.example`
- `deploy/install-lib.sh`, `deploy/install.sh`
- `deploy/backup.sh`, `deploy/restore.sh`
- `deploy/ci-smoke.sh` and deployment shell contracts
- `app/routes/media.$.ts`, PostgreSQL and local-storage adapters
- [Docker deployment runbook](../../dev/deploy.md)

## Production Evidence

- Product version: `0.2.0`
- Production commit: `c5131aaa0335250a3846c380519324fbbf4b231b`
- Site: `https://one-image2.tangguo.xin`
- Existing-proxy upstream: `127.0.0.1:18080`
- Services: `postgres`, `web`, `worker`, `scheduler` running
- Health: local and public `/healthz` returned `204`
- Backup: `deploy/backups/20260713T145807Z`; database, media and manifest checksums passed

## Final Implementation Notes

The final production target is the later all-local design: PostgreSQL and media live on the same Debian host. Earlier Neon/S3 compatibility remains optional and is not a production dependency. The live site uses the existing Nginx proxy rather than bundled Caddy.

## Ongoing Operations

- Publish encrypted off-host backup copies and run scheduled restore drills.
- Recheck real-provider generation and debit behavior for each release.
- Observe capacity before changing worker concurrency or introducing another queue system.
- Add multi-host high availability only through a separately approved future requirement.

The approved design is [2026-07-12-self-hosted-one-command-deployment-design.md](../specs/2026-07-12-self-hosted-one-command-deployment-design.md). Current state is [PROGRESS.md](../../PROGRESS.md).
