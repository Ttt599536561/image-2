#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_PATH='deploy/.env.production'
ENV_ABSOLUTE_PATH="$SCRIPT_DIR/.env.production"
BACKUPS_ROOT="$SCRIPT_DIR/backups"
BACKUPS_ROOT_RESOLVED=''

BACKUP_TIMESTAMP_VALUE=''
BACKUP_DIR=''
STAGING_DIR=''
MEDIA_VOLUME=''
RUNNING_SERVICES_OUTPUT=''
RUNNING_APP_SERVICES=()
SERVICES_MAY_NEED_RESTART=0
OPERATION_LOCK_FD=''

# install-lib.sh contains function definitions only; deployment values are parsed below.
# shellcheck source=deploy/install-lib.sh
source "$SCRIPT_DIR/install-lib.sh"

compose() {
  docker compose --env-file "$ENV_PATH" "$@"
}

acquire_operation_lock() {
  local lock_path="${INSTALL_LOCK_PATH:-/run/lock/ai-image-workshop-install.lock}"
  local lock_dir="${lock_path%/*}"
  command -v flock >/dev/null 2>&1 || die 'flock is required for backup'
  if [[ -n "${BACKUP_LOCK_FD-}" ]]; then
    [[ "${BACKUP_LOCK_INHERITED:-0}" == 1 ]] || die 'backup lock descriptor requires inherited-lock mode'
    [[ "${BACKUP_LOCK_FD}" =~ ^[0-9]+$ ]] || die 'invalid inherited backup lock descriptor'
    : >&"$BACKUP_LOCK_FD" || die 'inherited backup lock descriptor is unavailable'
    local expected_lock actual_lock
    expected_lock="$(realpath -e -- "$lock_path")" || die 'cannot resolve expected backup lock'
    actual_lock="$(realpath -e -- "/proc/$$/fd/$BACKUP_LOCK_FD")" || die 'cannot resolve inherited backup lock'
    [[ "$actual_lock" == "$expected_lock" ]] || die 'inherited backup lock does not match operation lock'
    flock -n "$BACKUP_LOCK_FD" || die 'inherited backup lock is not held'
    OPERATION_LOCK_FD="$BACKUP_LOCK_FD"
    return 0
  fi
  [[ "$lock_dir" != "$lock_path" && -d "$lock_dir" && ! -L "$lock_dir" ]] || die 'backup lock directory is unsafe'
  if [[ -e "$lock_path" || -L "$lock_path" ]]; then
    [[ -f "$lock_path" && ! -L "$lock_path" ]] || die 'backup lock target is unsafe'
  fi
  exec {OPERATION_LOCK_FD}>"$lock_path" || die 'cannot open backup lock'
  if ! flock -n "$OPERATION_LOCK_FD"; then
    exec {OPERATION_LOCK_FD}>&-
    OPERATION_LOCK_FD=''
    die 'another deployment operation is already running'
  fi
}

release_operation_lock() {
  if [[ -n "$OPERATION_LOCK_FD" ]]; then
    if [[ "${BACKUP_LOCK_INHERITED:-0}" != 1 ]]; then
      flock -u "$OPERATION_LOCK_FD" 2>/dev/null || true
      exec {OPERATION_LOCK_FD}>&-
    fi
    OPERATION_LOCK_FD=''
  fi
}

private_file_is_safe() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || return 1

  local mode
  mode="$(stat -c '%a' "$path")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (((0$mode & 077) == 0))
}

clear_deploy_variables() {
  unset COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT
  unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED
  unset STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL
  unset CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY
}

unexport_deploy_variables() {
  export -n COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED \
    STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL \
    CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY \
    2>/dev/null || true
}

validate_backup_environment() {
  local required_key
  for required_key in COMPOSE_PROJECT_NAME IMAGE_TAG POSTGRES_DB POSTGRES_USER STORAGE_DRIVER LOCAL_STORAGE_ROOT; do
    [[ -v "$required_key" ]] || {
      die "Deployment environment is missing: $required_key"
      return 1
    }
  done

  [[ "$COMPOSE_PROJECT_NAME" == 'ai-image-workshop' ]] || {
    die 'COMPOSE_PROJECT_NAME must be ai-image-workshop'
    return 1
  }
  [[ "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._:/@-]*$ ]] || {
    die 'IMAGE_TAG is invalid'
    return 1
  }
  [[ "$POSTGRES_DB" =~ ^[A-Za-z0-9_]+$ && "$POSTGRES_USER" =~ ^[A-Za-z0-9_]+$ ]] || {
    die 'PostgreSQL database or user name is invalid'
    return 1
  }
  [[ "$STORAGE_DRIVER" == 'local' && "$LOCAL_STORAGE_ROOT" == '/app/data/media' ]] || {
    die 'Local media storage configuration is invalid'
    return 1
  }

  MEDIA_VOLUME="${COMPOSE_PROJECT_NAME}_media_data"
  [[ "$MEDIA_VOLUME" == 'ai-image-workshop_media_data' && "$MEDIA_VOLUME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || {
    die 'Media volume name is invalid'
    return 1
  }
}

safe_remove_backup_directory() {
  local target="$1"
  local allowed_kind="$2"
  [[ -n "$BACKUPS_ROOT_RESOLVED" && -d "$target" && ! -L "$target" ]] || return 1

  local resolved_target target_name
  resolved_target="$(cd -- "$target" && pwd -P)" || return 1
  [[ "$resolved_target" == "$BACKUPS_ROOT_RESOLVED/"* ]] || return 1
  target_name="${resolved_target#"$BACKUPS_ROOT_RESOLVED/"}"
  [[ -n "$target_name" && "$target_name" != */* ]] || return 1

  case "$allowed_kind" in
    completed)
      [[ "$target_name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || return 1
      ;;
    staging)
      [[ "$target_name" =~ ^\.[0-9]{8}T[0-9]{6}Z\.tmp\.[A-Za-z0-9]+$ ]] || return 1
      ;;
    *)
      return 1
      ;;
  esac

  rm -rf -- "$resolved_target"
}

retain_recent_backups() {
  local -a completed_backups=()
  local candidate candidate_name
  shopt -s nullglob
  for candidate in \
    "$BACKUPS_ROOT_RESOLVED"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z; do
    [[ -d "$candidate" && ! -L "$candidate" ]] || continue
    candidate_name="${candidate##*/}"
    [[ "$candidate_name" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
    local artifact
    local complete=1
    for artifact in database.dump media.tar.gz manifest.env SHA256SUMS; do
      [[ -f "$candidate/$artifact" && ! -L "$candidate/$artifact" ]] || complete=0
    done
    ((complete == 1)) || continue
    (cd "$candidate" && sha256sum --check --strict SHA256SUMS >/dev/null 2>&1) || continue
    completed_backups+=("$candidate")
  done
  shopt -u nullglob

  # The fixed-width UTC names sort chronologically. Sort newest first without
  # feeding deletion paths through another process.
  local left right temporary
  for ((left = 0; left < ${#completed_backups[@]}; left += 1)); do
    for ((right = left + 1; right < ${#completed_backups[@]}; right += 1)); do
      if [[ "${completed_backups[right]##*/}" > "${completed_backups[left]##*/}" ]]; then
        temporary="${completed_backups[left]}"
        completed_backups[left]="${completed_backups[right]}"
        completed_backups[right]="$temporary"
      fi
    done
  done

  for ((left = 7; left < ${#completed_backups[@]}; left += 1)); do
    safe_remove_backup_directory "${completed_backups[left]}" completed || {
      die "Refusing unsafe backup retention target: ${completed_backups[left]}"
      return 1
    }
  done
}

restart_and_cleanup() {
  local original_status=$?
  local final_status="$original_status"
  local operation_status=0
  trap - EXIT HUP INT TERM
  set +e

  if ((original_status != 0 || ${BACKUP_LEAVE_STOPPED_ON_SUCCESS:-0} != 1)) &&
    ((SERVICES_MAY_NEED_RESTART == 1 && ${#RUNNING_APP_SERVICES[@]} > 0)); then
    compose start "${RUNNING_APP_SERVICES[@]}"
    operation_status=$?
    if ((original_status == 0 && operation_status != 0)); then
      final_status="$operation_status"
    fi
  fi

  if [[ -n "$STAGING_DIR" && ( -e "$STAGING_DIR" || -L "$STAGING_DIR" ) ]]; then
    safe_remove_backup_directory "$STAGING_DIR" staging
    operation_status=$?
    if ((original_status == 0 && final_status == 0 && operation_status != 0)); then
      final_status="$operation_status"
    fi
  fi

  if ((final_status == 0)); then
    printf 'Backup created: %s\n' "$BACKUP_DIR"
  fi
  release_operation_lock
  unset POSTGRES_PASSWORD DATABASE_URL DATABASE_URL_UNPOOLED BETTER_AUTH_SECRET RELAY_API_KEY CUSTOM_KEY_JOB_ENCRYPTION_KEY
  exit "$final_status"
}

exit_for_signal() {
  local signal_status="$1"
  trap - HUP INT TERM
  exit "$signal_status"
}

cd -- "$PROJECT_ROOT"
acquire_operation_lock

private_file_is_safe "$ENV_ABSOLUTE_PATH" || {
  die "Deployment environment must be a private regular file: $ENV_PATH"
  exit 1
}

clear_deploy_variables
load_deploy_env "$ENV_PATH"
unexport_deploy_variables
validate_backup_environment

for required_volume in "${COMPOSE_PROJECT_NAME}_postgres_data" "$MEDIA_VOLUME"; do
  docker volume inspect "$required_volume" >/dev/null 2>&1 || {
    die "Required Docker volume is missing: $required_volume"
    release_operation_lock
    exit 1
  }
done

if [[ -e "$BACKUPS_ROOT" || -L "$BACKUPS_ROOT" ]]; then
  [[ -d "$BACKUPS_ROOT" && ! -L "$BACKUPS_ROOT" ]] || {
    die "Backup root must be a regular directory: $BACKUPS_ROOT"
    exit 1
  }
else
  mkdir -m 0700 -- "$BACKUPS_ROOT"
fi
chmod 0700 -- "$BACKUPS_ROOT"
BACKUPS_ROOT_RESOLVED="$(cd -- "$BACKUPS_ROOT" && pwd -P)"

if [[ -v BACKUP_TIMESTAMP ]]; then
  BACKUP_TIMESTAMP_VALUE="$BACKUP_TIMESTAMP"
else
  BACKUP_TIMESTAMP_VALUE="$(date -u +%Y%m%dT%H%M%SZ)"
fi
[[ "$BACKUP_TIMESTAMP_VALUE" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || {
  die 'Backup timestamp is invalid'
  exit 1
}

BACKUP_DIR="$BACKUPS_ROOT_RESOLVED/$BACKUP_TIMESTAMP_VALUE"
[[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || {
  die "Backup already exists: $BACKUP_DIR"
  exit 1
}

if RUNNING_SERVICES_OUTPUT="$(compose ps --status running --services web worker scheduler)"; then
  :
else
  probe_status=$?
  die 'Unable to determine running application services' || true
  exit "$probe_status"
fi

declare -A seen_running_services=()
while IFS= read -r service_name; do
  [[ -n "$service_name" ]] || continue
  case "$service_name" in
    web | worker | scheduler)
      ;;
    *)
      die "Unexpected service returned by Compose: $service_name"
      exit 1
      ;;
  esac
  if [[ ! ${seen_running_services[$service_name]+present} ]]; then
    seen_running_services["$service_name"]=1
    RUNNING_APP_SERVICES+=("$service_name")
  fi
done <<<"$RUNNING_SERVICES_OUTPUT"

STAGING_DIR="$(mktemp -d "$BACKUPS_ROOT_RESOLVED/.${BACKUP_TIMESTAMP_VALUE}.tmp.XXXXXX")"
chmod 0700 -- "$STAGING_DIR"
trap restart_and_cleanup EXIT
trap 'exit_for_signal 129' HUP
trap 'exit_for_signal 130' INT
trap 'exit_for_signal 143' TERM

if ((${#RUNNING_APP_SERVICES[@]} > 0)); then
  # Set this before stopping so a partially successful stop is also recovered.
  SERVICES_MAY_NEED_RESTART=1
  compose stop "${RUNNING_APP_SERVICES[@]}"
fi

compose exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -Fc >"$STAGING_DIR/database.dump"

docker run --rm \
  --volume "$MEDIA_VOLUME:/source:ro" \
  --volume "$STAGING_DIR:/backup" \
  --workdir /backup \
  alpine:3.22 tar -czf media.tar.gz -C /source .

git_commit='unknown'
if candidate_commit="$(git rev-parse --verify HEAD 2>/dev/null)" && [[ "$candidate_commit" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
  git_commit="${candidate_commit,,}"
fi

cat >"$STAGING_DIR/manifest.env" <<EOF
BACKUP_FORMAT_VERSION=1
BACKUP_TIMESTAMP=$BACKUP_TIMESTAMP_VALUE
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
IMAGE_TAG=$IMAGE_TAG
GIT_COMMIT=$git_commit
EOF

chmod 0600 -- "$STAGING_DIR/database.dump" "$STAGING_DIR/media.tar.gz" "$STAGING_DIR/manifest.env"
(
  cd -- "$STAGING_DIR"
  sha256sum database.dump media.tar.gz manifest.env >SHA256SUMS
)
chmod 0600 -- "$STAGING_DIR/SHA256SUMS"

for artifact in database.dump media.tar.gz manifest.env SHA256SUMS; do
  [[ -f "$STAGING_DIR/$artifact" && ! -L "$STAGING_DIR/$artifact" ]] || {
    die "Backup artifact is not a regular file: $artifact"
    exit 1
  }
done

mv -T -- "$STAGING_DIR" "$BACKUP_DIR"
STAGING_DIR=''
chmod 0700 -- "$BACKUP_DIR"
chmod 0600 -- "$BACKUP_DIR/database.dump" "$BACKUP_DIR/media.tar.gz" \
  "$BACKUP_DIR/manifest.env" "$BACKUP_DIR/SHA256SUMS"

retain_recent_backups
exit 0
