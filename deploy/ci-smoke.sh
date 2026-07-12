#!/usr/bin/env bash
# shellcheck disable=SC1091
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
PRODUCTION_ENV_PATH="$SCRIPT_DIR/.env.production"

# shellcheck source=deploy/install-lib.sh
source "$SCRIPT_DIR/install-lib.sh"
cd -- "$PROJECT_ROOT"

RUN_ID="${GITHUB_RUN_ID:-local}"
IMAGE_TAG_VALUE="${IMAGE_TAG:-ci}"
PROJECT_NAME=''
ENV_FILE=''
ENV_RELATIVE_PATH=''
OVERRIDE_FILE=''
OVERRIDE_RELATIVE_PATH=''
PORT_3000_PID=''
PORT_3000_TOKEN=''
WEB_HOST_PORT_VALUE=''
POSTGRES_PASSWORD_VALUE=''
BETTER_AUTH_SECRET_VALUE=''
ENCRYPTION_KEY_VALUE=''
COMPOSE_CLEANUP_ALLOWED=0
SMOKE_ASSERTIONS_PASSED=0
COMPOSE_COMMAND=()
CLEANUP_COMPOSE_COMMAND=()

ADMIN_EMAIL='admin@example.test'
ADMIN_PASSWORD='ci-password-123'
POSTGRES_DB_VALUE='ai_image_workshop'
POSTGRES_USER_VALUE='ai_image_workshop'

die() {
  printf 'self-hosted compose smoke failed: %s\n' "$*" >&2
  return 1
}

project_name_is_safe() {
  [[ "$PROJECT_NAME" =~ ^ai-image-workshop-ci-[a-z0-9][a-z0-9_-]{0,31}-[0-9]+$ ]]
}

project_resources_exist() {
  local ids=''
  ids="$(timeout --signal=KILL 10 docker ps -aq \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 2
  [[ -z "$ids" ]] || return 0
  ids="$(timeout --signal=KILL 10 docker volume ls -q \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 2
  [[ -z "$ids" ]] || return 0
  ids="$(timeout --signal=KILL 10 docker network ls -q --filter \
    "label=com.docker.compose.project=$PROJECT_NAME")" || return 2
  [[ -z "$ids" ]] || return 0
  return 1
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  local ids=''
  trap - EXIT HUP INT TERM
  set +e

  if [[ -n "$PORT_3000_PID" && "$PORT_3000_PID" =~ ^[0-9]+$ ]]; then
    kill "$PORT_3000_PID" >/dev/null 2>&1 || true
    wait "$PORT_3000_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "$ENV_FILE" && -n "$OVERRIDE_FILE" ]]; then
    rm -f -- "$ENV_FILE" "$OVERRIDE_FILE" || cleanup_status=1
  elif [[ -n "$ENV_FILE" ]]; then
    rm -f -- "$ENV_FILE" || cleanup_status=1
  elif [[ -n "$OVERRIDE_FILE" ]]; then
    rm -f -- "$OVERRIDE_FILE" || cleanup_status=1
  fi
  if [[ -n "$ENV_FILE" && ( -e "$ENV_FILE" || -L "$ENV_FILE" ) ]]; then
    printf 'temporary smoke environment remains after cleanup\n' >&2
    cleanup_status=1
  fi
  if [[ -n "$OVERRIDE_FILE" && ( -e "$OVERRIDE_FILE" || -L "$OVERRIDE_FILE" ) ]]; then
    printf 'temporary smoke override remains after cleanup\n' >&2
    cleanup_status=1
  fi

  if ((COMPOSE_CLEANUP_ALLOWED == 1)) && project_name_is_safe && \
    ((${#CLEANUP_COMPOSE_COMMAND[@]} > 0)); then
    if ! timeout --signal=KILL 90 "${CLEANUP_COMPOSE_COMMAND[@]}" \
      down --volumes --remove-orphans >/dev/null 2>&1; then
      printf 'isolated Compose cleanup timed out or failed for %s\n' "$PROJECT_NAME" >&2
      cleanup_status=1
    fi

    if ids="$(timeout --signal=KILL 10 docker ps -aq \
      --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
      if [[ -n "$ids" ]]; then
        printf 'isolated project containers remain after cleanup: %s\n' "$PROJECT_NAME" >&2
        cleanup_status=1
      fi
    else
      printf 'cannot verify isolated project containers after cleanup: %s\n' "$PROJECT_NAME" >&2
      cleanup_status=1
    fi
    if ids="$(timeout --signal=KILL 10 docker volume ls -q \
      --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
      if [[ -n "$ids" ]]; then
        printf 'isolated project volumes remain after cleanup: %s\n' "$PROJECT_NAME" >&2
        cleanup_status=1
      fi
    else
      printf 'cannot verify isolated project volumes after cleanup: %s\n' "$PROJECT_NAME" >&2
      cleanup_status=1
    fi
    if ids="$(timeout --signal=KILL 10 docker network ls -q --filter \
      "label=com.docker.compose.project=$PROJECT_NAME")"; then
      if [[ -n "$ids" ]]; then
        printf 'isolated project networks remain after cleanup: %s\n' "$PROJECT_NAME" >&2
        cleanup_status=1
      fi
    else
      printf 'cannot verify isolated project networks after cleanup: %s\n' "$PROJECT_NAME" >&2
      cleanup_status=1
    fi
  fi

  if ((original_status == 0 && cleanup_status != 0)); then
    original_status="$cleanup_status"
  fi
  if ((original_status == 0 && SMOKE_ASSERTIONS_PASSED == 1)); then
    printf 'self-hosted compose smoke passed\n'
  fi
  exit "$original_status"
}

random_hex() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

random_base64url() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
}

write_env_line() {
  local key="$1" value="$2" quoted
  quoted="$(dotenv_quote "$value")" || return 1
  printf '%s=%s\n' "$key" "$quoted"
}

write_smoke_environment() {
  local database_url="postgresql://${POSTGRES_USER_VALUE}:${POSTGRES_PASSWORD_VALUE}@postgres:5432/${POSTGRES_DB_VALUE}"
  local -a entries=(
    COMPOSE_PROJECT_NAME "$PROJECT_NAME"
    COMPOSE_PROFILES ''
    IMAGE_TAG "$IMAGE_TAG_VALUE"
    DOMAIN ''
    WEB_BIND_ADDRESS '127.0.0.1'
    WEB_HOST_PORT "$WEB_HOST_PORT_VALUE"
    POSTGRES_DB "$POSTGRES_DB_VALUE"
    POSTGRES_USER "$POSTGRES_USER_VALUE"
    POSTGRES_PASSWORD "$POSTGRES_PASSWORD_VALUE"
    DATABASE_DRIVER 'pg'
    DATABASE_URL "$database_url"
    DATABASE_URL_UNPOOLED "$database_url"
    STORAGE_DRIVER 'local'
    LOCAL_STORAGE_ROOT '/app/data/media'
    BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET_VALUE"
    BETTER_AUTH_URL "http://127.0.0.1:${WEB_HOST_PORT_VALUE}"
    RELAY_API_KEY 'ci-dummy-relay-key-no-external-call'
    RELAY_BASE_URL 'http://127.0.0.1:9/v1'
    CUSTOM_KEY_JOB_ENCRYPTION_KEY "$ENCRYPTION_KEY_VALUE"
    CUSTOM_KEY_MODES_ENABLED 'false'
    WORKER_CONCURRENCY '1'
    TRUST_PROXY 'true'
  )

  local index
  for ((index = 0; index < ${#entries[@]}; index += 2)); do
    write_env_line "${entries[index]}" "${entries[index + 1]}"
  done >"$ENV_FILE"
  chmod 0600 -- "$ENV_FILE"
}

write_smoke_override() {
  cat >"$OVERRIDE_FILE" <<EOF
services:
  web:
    env_file: !override
      - path: $ENV_RELATIVE_PATH
        required: true
  worker:
    env_file: !override
      - path: $ENV_RELATIVE_PATH
        required: true
  scheduler:
    env_file: !override
      - path: $ENV_RELATIVE_PATH
        required: true
EOF
  chmod 0600 -- "$OVERRIDE_FILE"
}

select_free_web_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.on("error", (error) => { console.error(error.message); process.exit(1); });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") process.exit(1);
      process.stdout.write(String(address.port));
      server.close();
    });
  '
}

start_port_3000_occupier() {
  PORT_3000_TOKEN="ci-port-3000-${PROJECT_NAME}"
  node -e '
    const http = require("node:http");
    const token = process.argv[1];
    const server = http.createServer((_request, response) => response.end(token));
    server.on("error", () => process.exit(1));
    server.listen(3000, "127.0.0.1");
  ' "$PORT_3000_TOKEN" >/dev/null 2>&1 &
  PORT_3000_PID=$!

  local deadline=$((SECONDS + 10)) response=''
  while ((SECONDS < deadline)); do
    if ! kill -0 "$PORT_3000_PID" 2>/dev/null; then
      wait "$PORT_3000_PID" 2>/dev/null || true
      die 'the Node host-port-3000 occupier exited before becoming ready'
      return 1
    fi
    if response="$(curl --noproxy '*' --fail --silent --show-error \
      --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/)" && \
      [[ "$response" == "$PORT_3000_TOKEN" ]]; then
      return 0
    fi
    sleep 1
  done
  die 'the Node host-port-3000 occupier did not become ready'
}

assert_port_3000_occupier() {
  kill -0 "$PORT_3000_PID" 2>/dev/null || die 'the host-port-3000 occupier is no longer running'
  local response
  response="$(curl --noproxy '*' --fail --silent --show-error \
    --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/)" || return 1
  [[ "$response" == "$PORT_3000_TOKEN" ]] || die 'host port 3000 no longer serves the CI occupier'
}

wait_for_postgres() {
  local deadline=$((SECONDS + 120)) remaining probe_timeout
  while ((SECONDS < deadline)); do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || break
    probe_timeout=5
    ((probe_timeout < remaining)) || probe_timeout="$remaining"
    if timeout --signal=KILL "$probe_timeout" "${COMPOSE_COMMAND[@]}" exec -T postgres \
      pg_isready -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -t 1 >/dev/null 2>&1; then
      return 0
    fi
    ((SECONDS < deadline)) || break
    sleep 1
  done
  die 'PostgreSQL did not become ready within 120 seconds'
}

wait_for_web() {
  local deadline=$((SECONDS + 180)) code=''
  while ((SECONDS < deadline)); do
    if code="$(curl --noproxy '*' --silent --show-error --connect-timeout 2 --max-time 4 \
      --output /dev/null --write-out '%{http_code}' \
      "http://127.0.0.1:${WEB_HOST_PORT_VALUE}/healthz" 2>/dev/null)" && [[ "$code" == 204 ]]; then
      return 0
    fi
    ((SECONDS < deadline)) || break
    sleep 1
  done
  die 'web did not return HTTP 204 within 180 seconds'
}

assert_admin_roles() {
  local business_role auth_role
  business_role="$(timeout --signal=KILL 10 "${COMPOSE_COMMAND[@]}" exec -T postgres psql \
    -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -Atc \
    "SELECT role FROM users WHERE email='$ADMIN_EMAIL'")" || return 1
  auth_role="$(timeout --signal=KILL 10 "${COMPOSE_COMMAND[@]}" exec -T postgres psql \
    -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" -Atc \
    "SELECT role FROM \"user\" WHERE email='$ADMIN_EMAIL'")" || return 1
  [[ "$business_role" == admin && "$auth_role" == admin ]] || die 'administrator role verification failed'
}

assert_media_bytes() {
  curl --noproxy '*' --fail --silent --show-error --connect-timeout 2 --max-time 10 \
    "http://127.0.0.1:${WEB_HOST_PORT_VALUE}/media/ci/persist.png" | \
    cmp - <(printf '\001\002\003')
}

assert_exact_running_services() {
  local services expected
  services="$(timeout --signal=KILL 10 "${COMPOSE_COMMAND[@]}" \
    ps --status running --services | LC_ALL=C sort -u)" || return 1
  expected=$'postgres\nscheduler\nweb\nworker'
  [[ "$services" == "$expected" ]] || {
    printf 'unexpected running services for %s: %q\n' "$PROJECT_NAME" "$services" >&2
    return 1
  }
}

main() {
  (($# == 0)) || die 'ci-smoke.sh does not accept arguments'
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local command resource_status
  for command in docker node curl cmp mktemp chmod timeout sort sleep; do
    command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
  done
  timeout --signal=KILL 10 docker info >/dev/null 2>&1 || \
    die 'Docker daemon probe timed out or failed'
  timeout --signal=KILL 10 docker compose version >/dev/null 2>&1 || \
    die 'Docker Compose v2 probe timed out or failed'

  [[ "$RUN_ID" =~ ^[a-z0-9][a-z0-9_-]{0,31}$ ]] || die 'GITHUB_RUN_ID is unsafe for an isolated Compose project'
  [[ "$IMAGE_TAG_VALUE" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 'IMAGE_TAG is invalid for the CI image'
  PROJECT_NAME="ai-image-workshop-ci-${RUN_ID}-$$"
  project_name_is_safe || die 'isolated Compose project name failed validation'

  if project_resources_exist; then
    die "refusing to overwrite an existing isolated project: $PROJECT_NAME"
  else
    resource_status=$?
    ((resource_status == 1)) || die 'cannot inspect existing Docker project resources'
  fi

  timeout --signal=KILL 10 docker image inspect \
    "ai-image-workshop:${IMAGE_TAG_VALUE}" >/dev/null 2>&1 || \
    die "required image inspection timed out or image is missing: ai-image-workshop:${IMAGE_TAG_VALUE}"
  WEB_HOST_PORT_VALUE="$(select_free_web_port)"
  [[ "$WEB_HOST_PORT_VALUE" =~ ^[0-9]+$ ]] || die 'Node returned an invalid free port'
  ((WEB_HOST_PORT_VALUE >= 1 && WEB_HOST_PORT_VALUE <= 65535 && WEB_HOST_PORT_VALUE != 3000)) || \
    die 'selected web port is outside the safe range'

  ENV_FILE="$(mktemp "$SCRIPT_DIR/.ci-smoke.${PROJECT_NAME}.XXXXXX")"
  [[ "$ENV_FILE" != "$PRODUCTION_ENV_PATH" ]] || die 'refusing to replace deploy/.env.production'
  ENV_RELATIVE_PATH="deploy/${ENV_FILE##*/}"
  OVERRIDE_FILE="$SCRIPT_DIR/.ci-smoke.${PROJECT_NAME}.override.yaml"
  OVERRIDE_RELATIVE_PATH="deploy/${OVERRIDE_FILE##*/}"
  [[ ! -e "$OVERRIDE_FILE" && ! -L "$OVERRIDE_FILE" ]] || \
    die 'refusing to replace an existing smoke override'
  POSTGRES_PASSWORD_VALUE="$(random_hex)"
  BETTER_AUTH_SECRET_VALUE="$(random_base64url)"
  ENCRYPTION_KEY_VALUE="$(random_base64url)"
  write_smoke_environment
  write_smoke_override

  # Prevent caller variables from taking precedence over the isolated --env-file.
  unset DEPLOY_ENV_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT
  unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED
  unset STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL
  unset CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY
  COMPOSE_COMMAND=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_RELATIVE_PATH" \
    -f compose.yaml -f "$OVERRIDE_RELATIVE_PATH")
  CLEANUP_COMPOSE_COMMAND=(docker compose --project-name "$PROJECT_NAME" \
    --env-file deploy/.env.production.example -f compose.yaml)
  COMPOSE_CLEANUP_ALLOWED=1

  start_port_3000_occupier
  assert_port_3000_occupier
  timeout --signal=KILL 30 "${COMPOSE_COMMAND[@]}" config --quiet
  timeout --signal=KILL 60 "${COMPOSE_COMMAND[@]}" up -d postgres
  wait_for_postgres
  timeout --signal=KILL 180 "${COMPOSE_COMMAND[@]}" run --rm \
    -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
  SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    timeout --signal=KILL 180 "${COMPOSE_COMMAND[@]}" run --rm \
      -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD \
      web node --import tsx scripts/seed-admin.ts
  timeout --signal=KILL 240 "${COMPOSE_COMMAND[@]}" up -d web worker scheduler
  wait_for_web
  assert_admin_roles

  timeout --signal=KILL 30 "${COMPOSE_COMMAND[@]}" exec -T web \
    node --import tsx --input-type=module -e \
    "const m=await import('./src/server/local-storage.server.ts'); await m.writeLocalStorageObject('ci/persist.png',new Uint8Array([1,2,3]));"
  assert_media_bytes
  timeout --signal=KILL 240 "${COMPOSE_COMMAND[@]}" up -d --force-recreate \
    --wait --wait-timeout 180 web worker scheduler
  assert_media_bytes
  assert_exact_running_services
  assert_port_3000_occupier
  SMOKE_ASSERTIONS_PASSED=1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
