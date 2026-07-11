# Debian Docker Deployment Record

Status: local implementation complete; production rollout pending.

## Completed

- [x] Added Node SSR serving, `/healthz`, Dockerfile, Compose, Caddy, production
  environment template, and guarded database migration command.
- [x] Added persistent worker and scheduler processes around the existing
  PostgreSQL generation state machine.
- [x] Made persistent database-pool lifecycle explicit and added graceful
  shutdown paths.
- [x] Updated deployment runbook and verified typecheck, build, secret scan,
  Compose configuration, unit tests `188/188`, money tests `74/74`, and local
  SSR health/auth smoke.

## Still Required

- [ ] Build and start the image on the Debian host with registry access.
- [ ] Run the production migration and controlled system/custom smoke sequence.
- [ ] Complete administrator credential rotation and production rollback drill.

The approved design is in
[2026-07-11-debian-docker-deployment-design.md](../specs/2026-07-11-debian-docker-deployment-design.md).
The authoritative rollout checklist is [PROGRESS.md](../../PROGRESS.md) and the
commands are in [deploy.md](../../dev/deploy.md).
