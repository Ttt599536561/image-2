# Debian Docker production deployment

The production runtime is Docker Compose, not Netlify. The stack contains Caddy,
the React Router SSR web process, a generation worker, and one scheduler.

## 1. Host preparation

Use Debian 12 or newer. Install Docker Engine and the Compose plugin from the
official Docker repository, enable the service, and allow inbound TCP 80/443.
Point the production domain A/AAAA record at the server before starting Caddy.

## 2. Configuration

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Fill every database, auth, storage, relay, and encryption value. Set `DOMAIN`
and `BETTER_AUTH_URL=https://<domain>`. Keep
`CUSTOM_KEY_MODES_ENABLED=false` for the first rollout. Use the Neon pooled URL
for `DATABASE_URL` and direct URL for `DATABASE_URL_UNPOOLED`.

Never bake this file into the image or commit it. Apply the checked-in migrations
from a controlled maintenance container before the application rollout:

```bash
docker compose --env-file deploy/.env.production build web
docker compose --env-file deploy/.env.production run --rm \
  -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
```

This command must target a backed-up database and complete before `up -d`.
`/healthz` verifies the current generation deadline/credential schema, so Caddy
will not expose an application whose required migration is missing.

## 3. Deploy

```bash
docker compose --env-file deploy/.env.production config
docker compose --env-file deploy/.env.production build
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
```

Caddy obtains and renews TLS certificates automatically. Only Caddy publishes
host ports. Web, worker, and scheduler remain on the private Compose network.

## 4. Verify

```bash
curl -fsS -o /dev/null https://<domain>/healthz
curl -i https://<domain>/api/me
docker compose --env-file deploy/.env.production logs --tail=200 web worker scheduler caddy
```

Expected: `/healthz` is 204 and unauthenticated `/api/me` is 401. Then perform a
controlled system-key generation, confirm one terminal generation row, one
stored image, and at most one debit. Check logs and audit data for secret
redaction before enabling custom-key mode.

## 5. Operations and rollback

```bash
docker compose --env-file deploy/.env.production pull
docker compose --env-file deploy/.env.production up -d --build
docker compose --env-file deploy/.env.production logs -f worker
```

Tag every released image with `IMAGE_TAG`. Roll back by restoring the previous
tag and running `up -d`; do not roll application code back across an incompatible
database migration. Neon database backups/PITR and Supabase bucket backup or
replication remain separate operational responsibilities.

Run exactly one scheduler replica. Worker replicas may be increased after load
testing because `runGenerationJob` atomically claims database rows. If sustained
queue load outgrows PostgreSQL polling, evaluate Redis/Valkey plus BullMQ as a
later architecture change rather than mixing queue systems during this migration.
