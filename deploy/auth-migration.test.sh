#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="ai-image-workshop-auth-migration-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker run --detach --name "$CONTAINER" \
  --publish 127.0.0.1::5432 \
  --env POSTGRES_DB=auth_migration_test \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:17-bookworm >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d auth_migration_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d auth_migration_test >/dev/null

HOST_PORT="$(docker port "$CONTAINER" 5432/tcp | awk -F: 'NR == 1 { print $NF }')"
DATABASE_URL="postgresql://postgres@127.0.0.1:${HOST_PORT}/auth_migration_test"
export DATABASE_URL DATABASE_URL_UNPOOLED="$DATABASE_URL" DATABASE_DRIVER=pg
export BETTER_AUTH_SECRET='auth-migration-test-secret-32-bytes'
export BETTER_AUTH_URL='http://127.0.0.1:3000'

cd "$ROOT"
MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS node --import tsx scripts/migrate-production.ts

tables="$(docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -Atc \
  "SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user','session','account','verification')")"
[[ "$tables" == 'account,session,user,verification' ]] || {
  printf 'expected Better Auth tables, got: %s\n' "$tables" >&2
  exit 1
}

uuid_columns="$(docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND data_type='uuid' AND ((table_name IN ('user','session','account','verification') AND column_name='id') OR (table_name IN ('session','account') AND column_name='userId'))")"
[[ "$uuid_columns" == '6' ]] || {
  printf 'expected six Better Auth UUID identity columns, got: %s\n' "$uuid_columns" >&2
  exit 1
}

index_count="$(docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -Atc \
  "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('session_userId_idx','account_userId_idx','verification_identifier_idx')")"
[[ "$index_count" == '3' ]] || {
  printf 'expected three Better Auth lookup indexes, got: %s\n' "$index_count" >&2
  exit 1
}

docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -c \
  "DELETE FROM app_migrations WHERE name='0006_better_auth.sql'" >/dev/null
MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS node --import tsx scripts/migrate-production.ts
migration_count="$(docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -Atc \
  "SELECT count(*) FROM app_migrations WHERE name='0006_better_auth.sql'")"
[[ "$migration_count" == '1' ]] || {
  printf 'expected one recorded Better Auth migration, got: %s\n' "$migration_count" >&2
  exit 1
}

SEED_ADMIN_EMAIL=admin@example.test SEED_ADMIN_PASSWORD=initial-password \
  node --import tsx scripts/seed-admin.ts >/dev/null
SEED_ADMIN_EMAIL=admin@example.test SEED_ADMIN_PASSWORD=replacement-password \
  node --import tsx scripts/seed-admin.ts >/dev/null

role_rows="$(docker exec "$CONTAINER" psql -U postgres -d auth_migration_test -Atc \
  "SELECT role FROM users WHERE email='admin@example.test'; SELECT role FROM \"user\" WHERE email='admin@example.test'")"
[[ "$role_rows" == $'admin\nadmin' ]] || {
  printf 'expected both administrator roles\n' >&2
  exit 1
}

# JavaScript reads these values from process.env.
# shellcheck disable=SC2016
EXPECTED_PASSWORD=replacement-password REJECTED_PASSWORD=initial-password node --import tsx -e '
  const { auth } = await import("./src/lib/auth.ts");
  const context = await auth.$context;
  const record = await context.internalAdapter.findUserByEmail("admin@example.test", { includeAccounts: true });
  const credential = record?.accounts.find((account) => account.providerId === "credential");
  if (!credential?.password) process.exit(1);
  if (!(await context.password.verify({ password: process.env.EXPECTED_PASSWORD, hash: credential.password }))) process.exit(2);
  if (await context.password.verify({ password: process.env.REJECTED_PASSWORD, hash: credential.password })) process.exit(3);
  process.exit(0);
'

printf 'auth migration empty-database test passed\n'
