# Debian Docker Deployment Record

Status: completed and deployed on 2026-07-13 as part of the `0.2.0` production baseline.

## Delivered

- [x] Added Node SSR serving, `/healthz`, a multi-stage Dockerfile, Docker Compose, optional Caddy, a production environment template, and guarded database migrations.
- [x] Added persistent `worker` and singleton `scheduler` processes around the PostgreSQL generation state machine.
- [x] Made database-pool lifecycle and graceful shutdown explicit.
- [x] Kept PostgreSQL private, bound Web only to a loopback host port, and separated production secrets from Git.
- [x] Added install, resume, upgrade, backup, restore, health and deployment-CI contracts.
- [x] Deployed the final single-host topology to Tencent Cloud behind the existing Nginx proxy.

## Production Evidence

- Version: `0.2.0`
- Commit: `c5131aaa0335250a3846c380519324fbbf4b231b`
- Site: `https://one-image2.tangguo.xin`
- Services: `postgres`, `web`, `worker`, `scheduler` running
- Health: Web/PostgreSQL healthy; local and public `/healthz` returned `204`
- Upgrade backup: `deploy/backups/20260713T145807Z`, with all listed SHA-256 checks passing

## Ongoing Operations

The following are recurring operations, not missing implementation work:

- Rotate administrator credentials and revoke old sessions on schedule.
- Run controlled real-provider system/custom checks for each release.
- Exercise restore and rollback paths in an isolated maintenance window.
- Maintain monitoring, alerts and encrypted off-host backups.

The design is [2026-07-11-debian-docker-deployment-design.md](../specs/2026-07-11-debian-docker-deployment-design.md). Current production truth is [PROGRESS.md](../../PROGRESS.md), and commands are in [deploy.md](../../dev/deploy.md).
