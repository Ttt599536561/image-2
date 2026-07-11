#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
ENV_PATH="$DEPLOY_DIR/.env.production"
ENV_ARGUMENT='deploy/.env.production'
BACKUPS_ROOT="$DEPLOY_DIR/backups"
RESTORE_STATE_PATH="$DEPLOY_DIR/restore.state"

# shellcheck source=deploy/install-lib.sh
source "$DEPLOY_DIR/install-lib.sh"
cd "$PROJECT_ROOT"

POSTGRES_STARTED=false
APPLICATION_STARTED=false
CADDY_STARTED=false
MEDIA_WRITE_STARTED=false
MUTATION_STARTED=false
RESTORE_STATE_INITIALIZED=false
RESTORE_PHASE='validated'
BACKUP_DIR=''
OPERATION_LOCK_FD=''
CREATED_VOLUMES=()
COMPOSE_PROJECT_NAME=''
COMPOSE_PROFILES=''
IMAGE_TAG=''
DOMAIN=''
WEB_HOST_PORT=''
POSTGRES_DB=''
POSTGRES_USER=''
POSTGRES_PASSWORD=''
DATABASE_DRIVER=''
DATABASE_URL=''
DATABASE_URL_UNPOOLED=''
STORAGE_DRIVER=''
LOCAL_STORAGE_ROOT=''
BETTER_AUTH_SECRET=''
BETTER_AUTH_URL=''
RELAY_API_KEY=''
CUSTOM_KEY_JOB_ENCRYPTION_KEY=''
CUSTOM_KEY_MODES_ENABLED=''
WORKER_CONCURRENCY=''
TRUST_PROXY=''

cleanup_secrets() {
  unset POSTGRES_PASSWORD DATABASE_URL DATABASE_URL_UNPOOLED BETTER_AUTH_SECRET RELAY_API_KEY
  unset CUSTOM_KEY_JOB_ENCRYPTION_KEY
}

private_file_is_safe() {
  local path="$1" mode
  [[ -f "$path" && ! -L "$path" ]] || return 1
  mode="$(stat -c '%a' "$path")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (0$mode & 077) == 0 ))
}

clear_loaded_environment() {
  unset COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT
  unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED
  unset STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL
  unset CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY
}

unexport_sensitive_variables() {
  export -n POSTGRES_PASSWORD DATABASE_URL DATABASE_URL_UNPOOLED BETTER_AUTH_SECRET RELAY_API_KEY \
    CUSTOM_KEY_JOB_ENCRYPTION_KEY 2>/dev/null || true
}

compose() {
  [[ -f "$ENV_PATH" && ! -L "$ENV_PATH" ]] || die "unsafe deployment environment: $ENV_PATH"
  docker compose --env-file "$ENV_ARGUMENT" "$@"
}

acquire_operation_lock() {
  local lock_path="${INSTALL_LOCK_PATH:-/run/lock/ai-image-workshop-install.lock}"
  local lock_dir="${lock_path%/*}"
  command -v flock >/dev/null 2>&1 || die 'flock is required for restore'
  [[ "$lock_dir" != "$lock_path" && -d "$lock_dir" && ! -L "$lock_dir" ]] || die 'restore lock directory is unsafe'
  if [[ -e "$lock_path" || -L "$lock_path" ]]; then
    [[ -f "$lock_path" && ! -L "$lock_path" ]] || die 'restore lock target is unsafe'
  fi
  exec {OPERATION_LOCK_FD}>"$lock_path" || die 'cannot open restore lock'
  if ! flock -n "$OPERATION_LOCK_FD"; then
    exec {OPERATION_LOCK_FD}>&-
    OPERATION_LOCK_FD=''
    die 'another deployment operation is already running'
  fi
}

release_operation_lock() {
  if [[ -n "$OPERATION_LOCK_FD" ]]; then
    flock -u "$OPERATION_LOCK_FD" 2>/dev/null || true
    exec {OPERATION_LOCK_FD}>&-
    OPERATION_LOCK_FD=''
  fi
}

validate_loaded_environment() {
  local key
  for key in COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED \
    STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL \
    CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY; do
    [[ -v "$key" ]] || die "deployment environment is missing $key"
  done
  [[ "$COMPOSE_PROJECT_NAME" == 'ai-image-workshop' ]] || die 'COMPOSE_PROJECT_NAME must be ai-image-workshop'
  [[ "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]*$ ]] || die 'invalid IMAGE_TAG'
  [[ "$WEB_BIND_ADDRESS" == '127.0.0.1' && "$WEB_HOST_PORT" =~ ^[0-9]+$ ]] || die 'invalid web binding'
  ((WEB_HOST_PORT >= 1 && WEB_HOST_PORT <= 65535)) || die 'invalid web port'
  [[ "$POSTGRES_DB" =~ ^[A-Za-z0-9_]+$ && "$POSTGRES_USER" =~ ^[A-Za-z0-9_]+$ ]] || die 'invalid PostgreSQL identifier'
  [[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ && -n "$POSTGRES_PASSWORD" ]] || die 'invalid PostgreSQL password'
  local expected_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  [[ "$DATABASE_DRIVER" == 'pg' && "$DATABASE_URL" == "$expected_url" && "$DATABASE_URL_UNPOOLED" == "$expected_url" ]] || die 'invalid database URL'
  [[ "$STORAGE_DRIVER" == 'local' && "$LOCAL_STORAGE_ROOT" == '/app/data/media' ]] || die 'invalid storage configuration'
  [[ -n "$BETTER_AUTH_SECRET" && -n "$RELAY_API_KEY" && -n "$CUSTOM_KEY_JOB_ENCRYPTION_KEY" ]] || die 'required secret is empty'
  [[ "$CUSTOM_KEY_MODES_ENABLED" == 'false' && "$TRUST_PROXY" == 'true' ]] || die 'invalid application security settings'
  [[ "$WORKER_CONCURRENCY" =~ ^[1-9][0-9]*$ ]] || die 'invalid worker concurrency'
  if [[ "$COMPOSE_PROFILES" == 'caddy' ]]; then
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ && "$BETTER_AUTH_URL" == "https://$DOMAIN" ]] || die 'invalid Caddy domain'
  else
    [[ -z "$COMPOSE_PROFILES" && "$DOMAIN" == '' && "$BETTER_AUTH_URL" =~ ^https://[^/]+(:[0-9]+)?$ ]] || die 'invalid proxy configuration'
  fi
}

load_environment() {
  private_file_is_safe "$ENV_PATH" || die "unsafe deployment environment: $ENV_PATH"
  clear_loaded_environment
  load_deploy_env "$ENV_PATH"
  unexport_sensitive_variables
  validate_loaded_environment
}

path_has_symlink_component() {
  local input="$1" absolute current='/' component
  local -a components=()
  if [[ "$input" == /* ]]; then
    absolute="$input"
  else
    absolute="$PWD/$input"
  fi
  IFS='/' read -r -a components <<<"${absolute#/}"
  for component in "${components[@]}"; do
    case "$component" in
      ''|.) continue ;;
      ..) current="$(dirname -- "$current")" ;;
      *)
        current="${current%/}/$component"
        [[ ! -L "$current" ]] || return 0
        ;;
    esac
  done
  return 1
}

preflight_commands() {
  local command
  for command in docker sha256sum realpath stat mktemp flock timeout curl dirname basename sleep; do
    command -v "$command" >/dev/null 2>&1 || die "required command is missing: $command"
  done
}

resolve_backup_directory() {
  [[ -d "$BACKUPS_ROOT" && ! -L "$BACKUPS_ROOT" ]] || die 'backup root is missing or unsafe'
  local root candidate parent name input="$1" lexical relative first_component
  root="$(realpath -e -- "$BACKUPS_ROOT")" || die 'cannot resolve backup root'
  ! path_has_symlink_component "$input" || die 'backup path contains a symlink component'
  lexical="$(realpath -m -- "$input")" || die 'cannot normalize backup path'
  [[ "$lexical" == "$root/"* ]] || die 'backup path must be below deploy/backups'
  relative="${lexical#"$root/"}"
  first_component="${relative%%/*}"
  [[ -n "$first_component" && ! -L "$root/$first_component" ]] || die 'backup path contains a symlink component'
  candidate="$(realpath -e -- "$input")" || die 'backup path does not exist'
  parent="$(dirname -- "$candidate")"
  name="$(basename -- "$candidate")"
  [[ "$parent" == "$root" && "$candidate" == "$root/"* ]] || die 'backup path must be a direct child of deploy/backups'
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die 'backup directory name is invalid'
  [[ -d "$candidate" && ! -L "$candidate" ]] || die 'backup path is not a directory'
  BACKUP_DIR="$candidate"
}

verify_backup_files() {
  local file
  for file in database.dump media.tar.gz manifest.env SHA256SUMS; do
    [[ -f "$BACKUP_DIR/$file" && ! -L "$BACKUP_DIR/$file" ]] || die "backup is missing $file"
  done

  strict_backup_checksums_are_valid "$BACKUP_DIR" || die 'backup checksum manifest or payload verification failed'
}

parse_manifest() {
  local line key value
  local format='' timestamp='' project='' image='' commit=''
  declare -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || die 'manifest contains an invalid line'
    key="${line%%=*}"
    value="${line#*=}"
    [[ -z "${seen[$key]+present}" ]] || die 'manifest repeats a key'
    seen["$key"]=1
    case "$key" in
      BACKUP_FORMAT_VERSION) [[ -z "$format" ]] || die 'manifest repeats format version'; format="$value" ;;
      BACKUP_TIMESTAMP) [[ -z "$timestamp" ]] || die 'manifest repeats timestamp'; timestamp="$value" ;;
      COMPOSE_PROJECT_NAME) [[ -z "$project" ]] || die 'manifest repeats project'; project="$value" ;;
      IMAGE_TAG) [[ -z "$image" ]] || die 'manifest repeats image'; image="$value" ;;
      GIT_COMMIT) [[ -z "$commit" ]] || die 'manifest repeats commit'; commit="$value" ;;
      *) die 'manifest contains an unknown key' ;;
    esac
  done <"$BACKUP_DIR/manifest.env"
  [[ "$format" == '1' && "$timestamp" == "$(basename -- "$BACKUP_DIR")" && "$project" == "$COMPOSE_PROJECT_NAME" ]] || die 'manifest identity does not match restore target'
  [[ "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]*$ && "$commit" =~ ^(unknown|[0-9a-fA-F]{7,64})$ ]] || die 'manifest metadata is invalid'
}

running_project_guard() {
  local output
  if ! output="$(compose ps --status running --status restarting --status paused -q 2>/dev/null)"; then
    die 'unable to determine whether the Compose project is running'
    return 1
  fi
  [[ -z "${output//[$' \t\r\n']/}" ]] || die 'stop all project services before restore'
}

require_confirmation() {
  local answer=''
  printf 'Type RESTORE ai-image-workshop to continue: '
  IFS= read -r answer || die 'restore confirmation was not received'
  [[ "$answer" == 'RESTORE ai-image-workshop' ]] || die 'restore confirmation did not match'
}

ensure_volume() {
  local name="$1"
  local logical_name="${name#"${COMPOSE_PROJECT_NAME}_"}"
  if ! docker volume inspect "$name" >/dev/null 2>&1; then
    docker volume create \
      --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
      --label "com.docker.compose.volume=$logical_name" \
      "$name" >/dev/null
    CREATED_VOLUMES+=("$name")
  fi
  validate_owned_volume "$name" "$logical_name"
}

validate_owned_volume() {
  local volume_name="$1"
  local logical_name="$2"
  local metadata
  metadata="$(docker volume inspect --format \
    '{{.Driver}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' \
    "$volume_name")" || die "cannot inspect Docker volume ownership: $volume_name"
  [[ "$metadata" == "local|$COMPOSE_PROJECT_NAME|$logical_name" ]] || \
    die "Docker volume ownership is invalid: $volume_name"
}

assert_volume_empty() {
  local name="$1"
  docker run --rm --volume "${name}:/target:ro" alpine:3.22 \
    sh -c 'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)"'
}

validate_media_archive() {
  local verbose_listing path_listing entry
  verbose_listing="$(docker run --rm --volume "$BACKUP_DIR:/backup:ro" alpine:3.22 tar -tvzf /backup/media.tar.gz)" || die 'cannot inspect media archive types'
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    [[ -z "$entry" ]] && continue
    case "${entry:0:1}" in
      -|d) ;;
      *) die 'media archive contains a non-regular or non-directory entry' ;;
    esac
  done <<<"$verbose_listing"

  path_listing="$(docker run --rm --volume "$BACKUP_DIR:/backup:ro" alpine:3.22 tar -tzf /backup/media.tar.gz)" || die 'cannot inspect media archive paths'
  while IFS= read -r entry || [[ -n "$entry" ]]; do
    [[ -z "$entry" ]] && continue
    [[ "$entry" != /* && "$entry" != '..' && "$entry" != */.. && "$entry" != ../* && "$entry" != */../* ]] || die 'media archive contains an unsafe path'
  done <<<"$path_listing"
}

wait_for_postgres() {
  local timeout_seconds="${RESTORE_POSTGRES_HEALTH_TIMEOUT_SECONDS:-120}" command_timeout="${RESTORE_PROBE_COMMAND_TIMEOUT_SECONDS:-5}" attempt remaining probe_timeout
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || die 'invalid PostgreSQL health timeout'
  [[ "$command_timeout" =~ ^[1-9][0-9]*$ ]] || die 'invalid restore probe timeout'
  local deadline=$((SECONDS + timeout_seconds))
  for ((attempt = 0; SECONDS < deadline; attempt += 1)); do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || break
    probe_timeout="$command_timeout"
    ((probe_timeout < remaining)) || probe_timeout="$remaining"
    if timeout --signal=KILL "$probe_timeout" docker compose --env-file "$ENV_ARGUMENT" \
      exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t 1 >/dev/null 2>&1; then
      return 0
    fi
    ((SECONDS < deadline)) || break
    sleep 1
  done
  die 'PostgreSQL did not become ready during restore'
}

wait_for_web_health() {
  local timeout_seconds="${RESTORE_WEB_HEALTH_TIMEOUT_SECONDS:-180}" command_timeout="${RESTORE_PROBE_COMMAND_TIMEOUT_SECONDS:-5}" attempt code remaining probe_timeout
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || die 'invalid web health timeout'
  [[ "$command_timeout" =~ ^[1-9][0-9]*$ ]] || die 'invalid restore probe timeout'
  local deadline=$((SECONDS + timeout_seconds))
  for ((attempt = 0; SECONDS < deadline; attempt += 1)); do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || break
    probe_timeout="$command_timeout"
    ((probe_timeout < remaining)) || probe_timeout="$remaining"
    if code="$(timeout --signal=KILL "$probe_timeout" curl --silent --show-error --connect-timeout 2 --max-time 4 --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${WEB_HOST_PORT}/healthz" 2>/dev/null)" && [[ "$code" == '204' ]]; then
      return 0
    fi
    ((SECONDS < deadline)) || break
    sleep 1
  done
  die 'restored web service did not return HTTP 204'
}

write_restore_state() {
  local status="$1" temp
  temp="$(mktemp "${RESTORE_STATE_PATH}.tmp.XXXXXX" 2>/dev/null)" || return 1
  if ! {
    printf 'STATE_VERSION="1"\n'
    printf 'PHASE="%s"\n' "$RESTORE_PHASE"
    printf 'STATUS="%s"\n' "$status"
  } >"$temp"; then
    rm -f -- "$temp"
    return 1
  fi
  chmod 0600 "$temp" || { rm -f -- "$temp"; return 1; }
  mv -fT -- "$temp" "$RESTORE_STATE_PATH" || { rm -f -- "$temp"; return 1; }
}

cleanup_new_empty_volumes() {
  [[ "$MEDIA_WRITE_STARTED" == false ]] || return 0
  local index volume
  for ((index = ${#CREATED_VOLUMES[@]} - 1; index >= 0; index -= 1)); do
    volume="${CREATED_VOLUMES[index]}"
    if docker run --rm --volume "${volume}:/target:ro" alpine:3.22 \
      sh -c 'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)"' >/dev/null 2>&1; then
      docker volume rm "$volume" >/dev/null 2>&1 || true
    fi
  done
}

on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  if ((status != 0)); then
    if [[ "$CADDY_STARTED" == true ]]; then
      compose stop caddy >/dev/null 2>&1 || true
    fi
    if [[ "$APPLICATION_STARTED" == true ]]; then
      compose stop web worker scheduler >/dev/null 2>&1 || true
    fi
    if [[ "$POSTGRES_STARTED" == true ]]; then
      compose stop postgres >/dev/null 2>&1 || true
    fi
    if [[ "$RESTORE_STATE_INITIALIZED" == true ]]; then
      write_restore_state "$status" || true
    fi
    cleanup_new_empty_volumes || true
    if [[ "$MUTATION_STARTED" == true ]]; then
      printf 'Restore failed for %s at phase %s. Keep application services stopped; empty both target volumes before retrying this backup.\n' \
        "${BACKUP_DIR:-unknown}" "$RESTORE_PHASE" >&2
    fi
  fi
  release_operation_lock
  cleanup_secrets
  exit "$status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

main() {
  (($# == 1)) || die 'usage: restore.sh BACKUP_DIRECTORY'
  preflight_commands
  acquire_operation_lock
  load_environment
  resolve_backup_directory "$1"
  verify_backup_files
  parse_manifest
  docker run --rm --tmpfs /var/lib/postgresql/data --volume "$BACKUP_DIR:/backup:ro" postgres:17-bookworm \
    pg_restore --list /backup/database.dump >/dev/null
  validate_media_archive
  running_project_guard
  require_confirmation
  RESTORE_PHASE='confirmed'
  write_restore_state 0 || die 'cannot initialize restore.state before mutation'
  RESTORE_STATE_INITIALIZED=true

  local media_volume="${COMPOSE_PROJECT_NAME}_media_data"
  local postgres_volume="${COMPOSE_PROJECT_NAME}_postgres_data"
  RESTORE_PHASE='volumes_preparing'
  write_restore_state 0 || die 'cannot record volume preparation'
  ensure_volume "$media_volume"
  ensure_volume "$postgres_volume"
  assert_volume_empty "$media_volume"
  assert_volume_empty "$postgres_volume"
  RESTORE_PHASE='volumes_checked'
  write_restore_state 0 || die 'cannot record checked volumes'

  RESTORE_PHASE='media_restoring'
  write_restore_state 0 || die 'cannot record media restore start'
  MEDIA_WRITE_STARTED=true
  MUTATION_STARTED=true
  docker run --rm \
    --volume "${media_volume}:/target" \
    --volume "$BACKUP_DIR:/backup:ro" \
    alpine:3.22 tar -xzf /backup/media.tar.gz -C /target
  docker run --rm --volume "${media_volume}:/target" alpine:3.22 chown -R 1000:1000 /target
  RESTORE_PHASE='media_restored'
  write_restore_state 0 || die 'cannot record restored media state'

  RESTORE_PHASE='postgres_starting'
  write_restore_state 0 || die 'cannot record PostgreSQL start'
  POSTGRES_STARTED=true
  compose up -d postgres
  wait_for_postgres
  RESTORE_PHASE='postgres_started'
  write_restore_state 0 || die 'cannot record PostgreSQL state'
  RESTORE_PHASE='database_restoring'
  write_restore_state 0 || die 'cannot record database restore start'
  compose exec -T postgres pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --exit-on-error --single-transaction --clean --if-exists --no-owner --no-privileges \
    <"$BACKUP_DIR/database.dump"
  RESTORE_PHASE='database_restored'
  write_restore_state 0 || die 'cannot record database state'
  RESTORE_PHASE='migrating'
  write_restore_state 0 || die 'cannot record migration start'
  compose run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production
  RESTORE_PHASE='migrated'
  write_restore_state 0 || die 'cannot record migration state'
  RESTORE_PHASE='starting_services'
  write_restore_state 0 || die 'cannot record service start'
  APPLICATION_STARTED=true
  compose up -d --remove-orphans web worker scheduler
  if [[ "$COMPOSE_PROFILES" == 'caddy' ]]; then
    CADDY_STARTED=true
    compose --profile caddy up -d caddy
  fi
  wait_for_web_health
  RESTORE_PHASE='complete'
  write_restore_state 0 || die 'cannot record completion state'
  printf 'Restored backup %s\n' "$(basename -- "$BACKUP_DIR")"
}

main "$@"
