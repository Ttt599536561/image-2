#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SOURCE="$SCRIPT_DIR/backup.sh"
RESTORE_SOURCE="$SCRIPT_DIR/restore.sh"
LIBRARY_SOURCE="$SCRIPT_DIR/install-lib.sh"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT HUP INT TERM

PASS_COUNT=0
FAIL_COUNT=0
CASE_ROOT=''
FAKE_STATE=''
RUN_OUTPUT=''
RUN_STATUS=0

fail_assertion() {
  printf 'assertion failed: %s\n' "$1" >&2
  if [[ "${DEBUG_BACKUP_RESTORE_TESTS:-0}" == 1 ]]; then
    [[ ! -f "$RUN_OUTPUT" ]] || { printf '%s\n' '--- script output ---' >&2; cat "$RUN_OUTPUT" >&2; }
    [[ ! -f "$FAKE_STATE/docker.log" ]] || { printf '%s\n' '--- docker log ---' >&2; cat "$FAKE_STATE/docker.log" >&2; }
  fi
  exit 1
}

assert_equal() {
  local expected="$1" actual="$2" message="$3"
  [[ "$actual" == "$expected" ]] || fail_assertion "$message (expected '$expected', got '$actual')"
}

assert_contains() {
  local value="$1" expected="$2" message="$3"
  [[ "$value" == *"$expected"* ]] || fail_assertion "$message"
}

assert_not_contains() {
  local value="$1" rejected="$2" message="$3"
  [[ "$value" != *"$rejected"* ]] || fail_assertion "$message"
}

assert_ordered() {
  local remaining="$1"
  shift
  local expected
  for expected in "$@"; do
    [[ "$remaining" == *"$expected"* ]] || fail_assertion "ordered output is missing: $expected"
    remaining="${remaining#*"$expected"}"
  done
}

run_test() {
  local name="$1"
  shift
  if ("$@"); then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf 'ok %d - %s\n' "$PASS_COUNT" "$name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf 'not ok - %s\n' "$name" >&2
  fi
}

write_env() {
  cat >"$CASE_ROOT/deploy/.env.production" <<'ENV'
COMPOSE_PROJECT_NAME="ai-image-workshop"
COMPOSE_PROFILES=""
IMAGE_TAG="ai-image-workshop:local"
DOMAIN=""
WEB_BIND_ADDRESS="127.0.0.1"
WEB_HOST_PORT="18081"
POSTGRES_DB="ai_image_workshop"
POSTGRES_USER="ai_image_workshop"
POSTGRES_PASSWORD="database-secret"
DATABASE_DRIVER="pg"
DATABASE_URL="postgresql://ai_image_workshop:database-secret@postgres:5432/ai_image_workshop"
DATABASE_URL_UNPOOLED="postgresql://ai_image_workshop:database-secret@postgres:5432/ai_image_workshop"
STORAGE_DRIVER="local"
LOCAL_STORAGE_ROOT="/app/data/media"
BETTER_AUTH_SECRET="auth-secret"
BETTER_AUTH_URL="https://images.example.com"
RELAY_API_KEY="relay-secret"
RELAY_BASE_URL="https://relay.example.com"
CUSTOM_KEY_JOB_ENCRYPTION_KEY="encryption-secret"
CUSTOM_KEY_MODES_ENABLED="false"
WORKER_CONCURRENCY="2"
TRUST_PROXY="true"
ENV
  chmod 0600 "$CASE_ROOT/deploy/.env.production"
}

write_fake_commands() {
  mkdir -p "$CASE_ROOT/fake-bin"
  cat >"$CASE_ROOT/fake-bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'docker'
  printf ' %q' "$@"
  printf '\n'
} >>"$FAKE_DOCKER_LOG"

for variable_name in RELAY_API_KEY POSTGRES_PASSWORD DATABASE_URL DATABASE_URL_UNPOOLED BETTER_AUTH_SECRET CUSTOM_KEY_JOB_ENCRYPTION_KEY; do
  [[ -z "${!variable_name-}" ]] || : >"$FAKE_STATE/secret-leaked"
done

if [[ "${1-}" == volume && "${2-}" == inspect ]]; then
  [[ ! -e "$FAKE_STATE/volume-inspect-fails" ]]
  exit
fi

if [[ "${1-}" == compose ]]; then
  [[ "${2-}" == --env-file && "${3-}" == deploy/.env.production ]] || exit 65
  shift 3
  command_line=" $* "
  if [[ "$command_line" == *' ps --status running --services '* ]]; then
    [[ ! -e "$FAKE_STATE/ps-fails" ]] || exit 72
    [[ ! -f "$FAKE_STATE/running-services" ]] || cat "$FAKE_STATE/running-services"
    exit
  fi
  if [[ "$command_line" == *' ps --status running -q '* ]]; then
    [[ ! -e "$FAKE_STATE/ps-fails" ]] || exit 72
    [[ ! -f "$FAKE_STATE/running-containers" ]] || cat "$FAKE_STATE/running-containers"
    exit
  fi
  if [[ "$command_line" == *' stop '* ]]; then
    [[ ! -e "$FAKE_STATE/stop-fails" ]] || exit 74
    exit
  fi
  if [[ "$command_line" == *' start '* ]]; then
    [[ ! -e "$FAKE_STATE/start-fails" ]] || exit 75
    exit
  fi
  if [[ "$command_line" == *' pg_dump '* ]]; then
    if [[ -e "$FAKE_STATE/dump-terms" ]]; then
      kill -TERM "$PPID"
      exit 143
    fi
    [[ ! -e "$FAKE_STATE/dump-fails" ]] || exit 73
    printf 'custom database dump\n'
    exit
  fi
  if [[ "$command_line" == *' pg_isready '* ]]; then
    [[ ! -e "$FAKE_STATE/postgres-unhealthy" ]]
    exit
  fi
  if [[ "$command_line" == *' pg_restore '* ]]; then
    : >"$FAKE_STATE/database-written"
    [[ ! -e "$FAKE_STATE/restore-fails" ]] || exit 76
    exit
  fi
  if [[ "$command_line" == *' db:migrate:production '* ]]; then
    : >"$FAKE_STATE/migration-ran"
    exit
  fi
  if [[ "$command_line" == *' up -d postgres '* ]]; then
    : >"$FAKE_STATE/postgres-started"
    exit
  fi
  if [[ "$command_line" == *' up -d --remove-orphans web worker scheduler '* ]]; then
    : >"$FAKE_STATE/application-started"
    exit
  fi
  if [[ "$command_line" == *' --profile caddy up -d caddy '* ]]; then
    : >"$FAKE_STATE/caddy-started"
    exit
  fi
  exit
fi

if [[ "${1-}" == run ]]; then
  command_line=" $* "
  if [[ "$command_line" == *' pg_restore --list /backup/database.dump '* ]]; then
    exit
  fi
  if [[ "$command_line" == *' tar -tzf /backup/media.tar.gz '* ]]; then
    exit
  fi
  if [[ "$command_line" == *' tar -tvzf /backup/media.tar.gz '* ]]; then
    exit
  fi
  if [[ "$command_line" == *' tar -czf media.tar.gz '* || "$command_line" == *' tar -czf /backup/media.tar.gz '* ]]; then
    backup_mount=''
    for argument in "$@"; do
      [[ "$argument" == *:/backup ]] && backup_mount="${argument%:/backup}"
    done
    [[ -n "$backup_mount" ]] || exit 77
    printf 'media archive\n' >"$backup_mount/media.tar.gz"
    exit
  fi
  if [[ "$command_line" == *'find /target'* ]]; then
    if [[ "$command_line" == *'ai-image-workshop_media_data:/target'* ]]; then
      [[ ! -e "$FAKE_STATE/media-nonempty" ]]
    else
      [[ ! -e "$FAKE_STATE/postgres-nonempty" ]]
    fi
    exit
  fi
  if [[ "$command_line" == *' tar -xzf /backup/media.tar.gz '* ]]; then
    : >"$FAKE_STATE/media-written"
    exit
  fi
  if [[ "$command_line" == *' chown -R 1000:1000 /target '* ]]; then
    : >"$FAKE_STATE/media-chowned"
    exit
  fi
fi

exit 64
FAKE_DOCKER

  cat >"$CASE_ROOT/fake-bin/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail
printf '0123456789abcdef0123456789abcdef01234567\n'
FAKE_GIT

  cat >"$CASE_ROOT/fake-bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'curl'
  printf ' %q' "$@"
  printf '\n'
} >>"$FAKE_DOCKER_LOG"
[[ ! -e "$FAKE_STATE/health-fails" ]] || exit 7
printf '204'
FAKE_CURL

  chmod 0700 "$CASE_ROOT/fake-bin/"*
}

make_fixture() {
  local name="$1"
  CASE_ROOT="$TEST_ROOT/$name"
  FAKE_STATE="$CASE_ROOT/fake-state"
  RUN_OUTPUT="$CASE_ROOT/run.out"
  RUN_STATUS=0
  mkdir -p "$CASE_ROOT/deploy/backups" "$FAKE_STATE"
  [[ ! -f "$BACKUP_SOURCE" ]] || cp "$BACKUP_SOURCE" "$CASE_ROOT/deploy/backup.sh"
  [[ ! -f "$RESTORE_SOURCE" ]] || cp "$RESTORE_SOURCE" "$CASE_ROOT/deploy/restore.sh"
  cp "$LIBRARY_SOURCE" "$CASE_ROOT/deploy/install-lib.sh"
  printf 'services: {}\n' >"$CASE_ROOT/compose.yaml"
  write_env
  write_fake_commands
}

run_script() {
  local input="$1"
  shift
  if (
    cd "$CASE_ROOT"
    env \
      PATH="$CASE_ROOT/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP-20260712T120000Z}" \
      BACKUP_POSTGRES_HEALTH_TIMEOUT_SECONDS=2 \
      BACKUP_WEB_HEALTH_TIMEOUT_SECONDS=2 \
      BACKUP_PROBE_COMMAND_TIMEOUT_SECONDS=1 \
      INSTALL_LOCK_PATH="$FAKE_STATE/maintenance.lock" \
      FAKE_STATE="$FAKE_STATE" \
      FAKE_DOCKER_LOG="$FAKE_STATE/docker.log" \
      bash "$@"
  ) <"$input" >"$RUN_OUTPUT" 2>&1; then
    RUN_STATUS=0
  else
    RUN_STATUS=$?
  fi
}

run_backup() {
  local empty_input="$CASE_ROOT/empty.in"
  : >"$empty_input"
  run_script "$empty_input" deploy/backup.sh
}

run_restore() {
  local input="$1" backup_path="$2"
  run_script "$input" deploy/restore.sh "$backup_path"
}

make_restore_fixture() {
  local timestamp="${1:-20260711T120000Z}"
  local directory="$CASE_ROOT/deploy/backups/$timestamp"
  mkdir -p "$directory"
  printf 'database fixture\n' >"$directory/database.dump"
  printf 'media fixture\n' >"$directory/media.tar.gz"
  cat >"$directory/manifest.env" <<EOF
BACKUP_FORMAT_VERSION=1
BACKUP_TIMESTAMP=$timestamp
COMPOSE_PROJECT_NAME=ai-image-workshop
IMAGE_TAG=ai-image-workshop:local
GIT_COMMIT=0123456789abcdef0123456789abcdef01234567
EOF
  (cd "$directory" && sha256sum database.dump media.tar.gz manifest.env >SHA256SUMS)
  chmod 0600 "$directory/"*
  printf '%s\n' "$directory"
}

assert_no_secret_leak() {
  [[ ! -e "$FAKE_STATE/secret-leaked" ]] || fail_assertion 'Docker children must not inherit deployment secrets'
  local combined=''
  [[ ! -f "$FAKE_STATE/docker.log" ]] || combined+="$(<"$FAKE_STATE/docker.log")"
  combined+="$(<"$RUN_OUTPUT")"
  for secret in database-secret relay-secret auth-secret encryption-secret; do
    assert_not_contains "$combined" "$secret" 'logs and output must not contain deployment secrets'
  done
}

test_backup_artifacts_quiescing_and_retention() {
  [[ -f "$BACKUP_SOURCE" ]] || fail_assertion 'deploy/backup.sh is missing'
  make_fixture backup-success
  printf 'web\nscheduler\n' >"$FAKE_STATE/running-services"
  local index timestamp
  for index in 1 2 3 4 5 6 7 8; do
    printf -v timestamp '2026070%dT120000Z' "$index"
    mkdir -p "$CASE_ROOT/deploy/backups/$timestamp"
    printf 'db\n' >"$CASE_ROOT/deploy/backups/$timestamp/database.dump"
    printf 'media\n' >"$CASE_ROOT/deploy/backups/$timestamp/media.tar.gz"
    printf 'manifest\n' >"$CASE_ROOT/deploy/backups/$timestamp/manifest.env"
    (cd "$CASE_ROOT/deploy/backups/$timestamp" && sha256sum database.dump media.tar.gz manifest.env >SHA256SUMS)
  done
  mkdir -p "$CASE_ROOT/deploy/backups/keep-me"
  printf 'unknown\n' >"$CASE_ROOT/deploy/backups/keep-file"

  BACKUP_TIMESTAMP=20260712T120000Z run_backup
  assert_equal 0 "$RUN_STATUS" 'backup should succeed'
  local directory="$CASE_ROOT/deploy/backups/20260712T120000Z"
  for file in database.dump media.tar.gz manifest.env SHA256SUMS; do
    [[ -f "$directory/$file" && ! -L "$directory/$file" ]] || fail_assertion "backup should publish $file"
    assert_equal 600 "$(stat -c '%a' "$directory/$file")" 'backup artifacts must be private'
  done
  assert_equal 700 "$(stat -c '%a' "$directory")" 'timestamp backup directory must be mode 700'
  assert_equal 3 "$(wc -l <"$directory/SHA256SUMS" | tr -d ' ')" 'checksum manifest must cover exactly three payload files'
  (cd "$directory" && sha256sum -c SHA256SUMS >/dev/null) || fail_assertion 'published checksums must verify'
  local docker_log
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_ordered "$docker_log" \
    'ps --status running --services' \
    'stop web scheduler' \
    'pg_dump' \
    'ai-image-workshop_media_data:/source:ro' \
    'start web scheduler'
  assert_not_contains "$docker_log" 'start worker' 'backup must not start a service that was originally stopped'
  assert_contains "$docker_log" ' -Fc' 'database dump must use PostgreSQL custom format'
  assert_equal 7 "$(find "$CASE_ROOT/deploy/backups" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' | wc -l | tr -d ' ')" \
    'retention must keep only seven completed timestamp backups'
  [[ -d "$CASE_ROOT/deploy/backups/keep-me" && -f "$CASE_ROOT/deploy/backups/keep-file" ]] \
    || fail_assertion 'retention must preserve unknown entries'
  assert_not_contains "$(<"$directory/manifest.env")" 'secret' 'manifest must not contain secrets'
  assert_no_secret_leak
}

test_backup_failure_and_signal_restore_exact_services() {
  [[ -f "$BACKUP_SOURCE" ]] || fail_assertion 'deploy/backup.sh is missing'
  make_fixture backup-failure
  printf 'web\nworker\n' >"$FAKE_STATE/running-services"
  : >"$FAKE_STATE/dump-fails"
  BACKUP_TIMESTAMP=20260712T120001Z run_backup
  assert_equal 73 "$RUN_STATUS" 'pg_dump failure status must be preserved'
  local docker_log
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_contains "$docker_log" 'start web worker' 'failure cleanup must restore the exact original writers'
  assert_not_contains "$docker_log" 'start scheduler' 'failure cleanup must not start scheduler'
  [[ ! -e "$CASE_ROOT/deploy/backups/20260712T120001Z" ]] || fail_assertion 'failed backup must not publish a completed directory'

  rm -f "$FAKE_STATE/dump-fails"
  : >"$FAKE_STATE/dump-terms"
  : >"$FAKE_STATE/docker.log"
  BACKUP_TIMESTAMP=20260712T120002Z run_backup
  assert_equal 143 "$RUN_STATUS" 'TERM status must be preserved'
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_contains "$docker_log" 'start web worker' 'signal cleanup must restore the exact original writers'
}

test_backup_probe_failure_has_no_mutation() {
  [[ -f "$BACKUP_SOURCE" ]] || fail_assertion 'deploy/backup.sh is missing'
  make_fixture backup-probe
  : >"$FAKE_STATE/ps-fails"
  BACKUP_TIMESTAMP=20260712T120003Z run_backup
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'Compose running-service probe failure must fail backup'
  local docker_log
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_not_contains "$docker_log" ' stop ' 'probe failure must not stop services'
  assert_not_contains "$docker_log" ' pg_dump ' 'probe failure must not dump the database'
  assert_not_contains "$docker_log" ' tar -czf ' 'probe failure must not archive media'
}

test_restore_checksum_and_path_guards_precede_docker() {
  [[ -f "$RESTORE_SOURCE" ]] || fail_assertion 'deploy/restore.sh is missing'
  make_fixture restore-checksum
  local directory input outside
  directory="$(make_restore_fixture)"
  printf 'corrupt\n' >>"$directory/database.dump"
  input="$CASE_ROOT/confirm.in"
  printf 'RESTORE ai-image-workshop\n' >"$input"
  run_restore "$input" "$directory"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'checksum mismatch must refuse restore'
  [[ ! -e "$FAKE_STATE/docker.log" ]] || fail_assertion 'checksum mismatch must precede all Docker starts and volume mounts'

  outside="$CASE_ROOT/outside"
  mkdir -p "$outside"
  : >"$FAKE_STATE/docker.log"
  run_restore "$input" "$CASE_ROOT/deploy/backups/../..//outside"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'restore traversal must be rejected'
  [[ ! -s "$FAKE_STATE/docker.log" ]] || fail_assertion 'path rejection must precede Docker'
}

test_restore_running_confirmation_and_empty_volume_guards() {
  [[ -f "$RESTORE_SOURCE" ]] || fail_assertion 'deploy/restore.sh is missing'
  make_fixture restore-guards
  local directory input
  directory="$(make_restore_fixture)"
  input="$CASE_ROOT/confirm.in"
  printf 'RESTORE ai-image-workshop\n' >"$input"
  printf 'container-id\n' >"$FAKE_STATE/running-containers"
  run_restore "$input" "$directory"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'running services must refuse restore'
  assert_not_contains "$(<"$FAKE_STATE/docker.log")" ' tar -xzf ' 'running guard must precede media writes'

  rm -f "$FAKE_STATE/running-containers"
  : >"$FAKE_STATE/docker.log"
  printf 'restore ai-image-workshop\n' >"$input"
  run_restore "$input" "$directory"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'confirmation must be exact and case-sensitive'
  assert_not_contains "$(<"$FAKE_STATE/docker.log")" ' find /target ' 'bad confirmation must precede volume mounts'

  printf 'RESTORE ai-image-workshop\n' >"$input"
  : >"$FAKE_STATE/media-nonempty"
  : >"$FAKE_STATE/docker.log"
  run_restore "$input" "$directory"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'nonempty media volume must refuse restore'
  assert_not_contains "$(<"$FAKE_STATE/docker.log")" ' tar -xzf ' 'nonempty media must not be overwritten'

  rm -f "$FAKE_STATE/media-nonempty"
  : >"$FAKE_STATE/postgres-nonempty"
  : >"$FAKE_STATE/docker.log"
  run_restore "$input" "$directory"
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'nonempty PostgreSQL volume must refuse restore'
  assert_not_contains "$(<"$FAKE_STATE/docker.log")" ' tar -xzf ' 'both volume checks must finish before media is written'
}

test_restore_successful_order_and_secret_isolation() {
  [[ -f "$RESTORE_SOURCE" ]] || fail_assertion 'deploy/restore.sh is missing'
  make_fixture restore-success
  local directory input docker_log
  directory="$(make_restore_fixture)"
  input="$CASE_ROOT/confirm.in"
  printf 'RESTORE ai-image-workshop\n' >"$input"
  run_restore "$input" "$directory"
  assert_equal 0 "$RUN_STATUS" 'valid restore should succeed'
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_ordered "$docker_log" \
    'ps --status running -q' \
    'ai-image-workshop_media_data:/target:ro' \
    'ai-image-workshop_postgres_data:/target:ro' \
    'tar -xzf /backup/media.tar.gz' \
    'chown -R 1000:1000 /target' \
    'up -d postgres' \
    'pg_isready' \
    'pg_restore' \
    'db:migrate:production' \
    'up -d --remove-orphans web worker scheduler' \
    'curl'
  [[ -e "$FAKE_STATE/media-written" && -e "$FAKE_STATE/media-chowned" && -e "$FAKE_STATE/database-written" ]] \
    || fail_assertion 'restore must write and chown media, then restore the database'
  assert_no_secret_leak
}

run_test 'backup artifacts, exact quiescing, retention, and secrets' test_backup_artifacts_quiescing_and_retention
run_test 'backup failure and signal restore exact services' test_backup_failure_and_signal_restore_exact_services
run_test 'backup probe failure has no mutation' test_backup_probe_failure_has_no_mutation
run_test 'restore checksum and path guards precede Docker' test_restore_checksum_and_path_guards_precede_docker
run_test 'restore running, confirmation, and empty-volume guards' test_restore_running_confirmation_and_empty_volume_guards
run_test 'restore success order and secret isolation' test_restore_successful_order_and_secret_isolation

if ((FAIL_COUNT > 0)); then
  printf '%d backup/restore test(s) failed\n' "$FAIL_COUNT" >&2
  exit 1
fi

printf 'all %d backup/restore tests passed\n' "$PASS_COUNT"
