#!/usr/bin/env bash
# shellcheck disable=SC2317
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_SOURCE="$SCRIPT_DIR/install.sh"
LIBRARY_SOURCE="$SCRIPT_DIR/install-lib.sh"

if [[ ! -f "$INSTALLER_SOURCE" ]]; then
  printf 'not ok - installer exists\n' >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT HUP INT TERM

PASS_COUNT=0
FAIL_COUNT=0
CASE_ROOT=''
FAKE_STATE=''
RUN_OUTPUT=''
RUN_STATUS=0
TEST_OUTER_TIMEOUT_SECONDS=30
TEST_POSTGRES_HEALTH_TIMEOUT_SECONDS=120
TEST_WEB_HEALTH_TIMEOUT_SECONDS=180
TEST_PROBE_COMMAND_TIMEOUT_SECONDS=5

fail_assertion() {
  printf 'assertion failed: %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [[ "$actual" == "$expected" ]] || fail_assertion "$message (expected '$expected', got '$actual')"
}

assert_contains() {
  local value="$1"
  local expected="$2"
  local message="$3"
  [[ "$value" == *"$expected"* ]] || fail_assertion "$message"
}

assert_not_contains() {
  local value="$1"
  local rejected="$2"
  local message="$3"
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

if [[ "${1-}" == 'info' ]]; then
  while [[ -e "$FAKE_STATE/docker-info-blocks" ]]; do /bin/sleep 0.1; done
  [[ ! -e "$FAKE_STATE/docker-info-fails" ]]
  exit
fi

if [[ "${1-}" == 'volume' && "${2-}" == 'inspect' ]]; then
  volume_name="${3-}"
  if grep -Fxq -- "$volume_name" "$FAKE_STATE/volumes" 2>/dev/null; then
    printf '[{}]\n'
    exit 0
  fi
  exit 1
fi

if [[ "${1-}" != 'compose' ]]; then
  exit 64
fi

if [[ "${2-}" == 'version' ]]; then
  [[ ! -e "$FAKE_STATE/compose-version-fails" ]]
  exit
fi

[[ "${2-}" == '--env-file' && "${3-}" == 'deploy/.env.production' ]] || exit 65
[[ -f 'deploy/.env.production' ]] || exit 66
shift 3

if [[ " $* " == *' logs '* ]]; then
  [[ ! -f "$FAKE_STATE/service-logs" ]] || cat "$FAKE_STATE/service-logs"
  exit 0
fi
if [[ " $* " == *' ps '* ]]; then
  printf 'NAME STATUS\nweb failed\n'
  exit 0
fi

if [[ " $* " == *' scripts/seed-admin.ts '* && -e "$FAKE_STATE/seed-fails-with-secret" ]]; then
  printf 'seed stdout leaked password: %s\n' "${SEED_ADMIN_PASSWORD-}"
  printf 'seed stderr leaked password: %s\n' "${SEED_ADMIN_PASSWORD-}" >&2
  printf 'service log leaked password: %s\n' "${SEED_ADMIN_PASSWORD-}" >"$FAKE_STATE/service-logs"
  exit 92
fi

fail_match=''
[[ ! -f "$FAKE_STATE/fail-match" ]] || fail_match="$(<"$FAKE_STATE/fail-match")"
if [[ -n "$fail_match" && " $* " == *"$fail_match"* ]]; then
  exit 91
fi

if [[ " $* " == *' up -d postgres '* ]]; then
  : >"$FAKE_STATE/postgres-up"
  exit 0
fi

if [[ " $* " == *' exec -T postgres pg_isready '* ]]; then
  if [[ -e "$FAKE_STATE/postgres-probe-blocks" ]]; then /bin/sleep 30; fi
  if [[ -e "$FAKE_STATE/require-runtime-start" && ! -e "$FAKE_STATE/postgres-up" ]]; then
    exit 70
  fi
  exit 0
fi

if [[ " $* " == *' up -d web worker scheduler '* ]]; then
  : >"$FAKE_STATE/app-up"
  exit 0
fi

if [[ " $* " == *' --profile caddy up -d caddy '* ]]; then
  : >"$FAKE_STATE/caddy-up"
  exit 0
fi

if [[ " $* " == *' scripts/seed-admin.ts '* ]]; then
  [[ -n "${SEED_ADMIN_EMAIL-}" && -n "${SEED_ADMIN_PASSWORD-}" ]] || exit 67
  [[ -z "${RELAY_API_KEY-}" ]] || exit 68
  printf 'seed-admin-email=present\nseed-admin-password=present\n' >"$FAKE_STATE/seed-env-present"
  exit 0
fi

if [[ " $* " == *' psql '* ]]; then
  if [[ -e "$FAKE_STATE/require-runtime-start" && ! -e "$FAKE_STATE/postgres-up" ]]; then
    exit 71
  fi
  [[ -z "${SEED_ADMIN_EMAIL-}" && -z "${SEED_ADMIN_PASSWORD-}" ]] || exit 69
  printf 'seed-environment-cleared\n' >"$FAKE_STATE/seed-env-cleared"
  if [[ -f "$FAKE_STATE/roles" ]]; then
    cat "$FAKE_STATE/roles"
  else
    printf 'admin\nadmin\n'
  fi
  exit 0
fi

exit 0
FAKE_DOCKER

  cat >"$CASE_ROOT/fake-bin/openssl" <<'FAKE_OPENSSL'
#!/usr/bin/env bash
set -euo pipefail
[[ -z "${FAKE_STATE-}" ]] || : >"$FAKE_STATE/openssl-called"
if [[ "$*" == 'rand -hex 32' ]]; then
  printf '%064d\n' 0 | tr '0' 'a'
elif [[ "$*" == 'rand -base64 32' ]]; then
  printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n'
else
  exit 64
fi
FAKE_OPENSSL

  cat >"$CASE_ROOT/fake-bin/ss" <<'FAKE_SS'
#!/usr/bin/env bash
set -euo pipefail
port="${*: -1}"
port="${port##*:}"
if grep -Fxq -- "$port" "$FAKE_STATE/occupied-ports" 2>/dev/null; then
  printf 'LISTEN 0 128 127.0.0.1:%s 0.0.0.0:*\n' "$port"
fi
FAKE_SS

  cat >"$CASE_ROOT/fake-bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'curl'
  printf ' %q' "$@"
  printf '\n'
} >>"$FAKE_CURL_LOG"
if [[ -f "$FAKE_STATE/curl-fails" ]]; then
  exit 7
fi
if [[ -e "$FAKE_STATE/curl-blocks" ]]; then /bin/sleep 30; fi
if [[ -e "$FAKE_STATE/require-runtime-start" && ! -e "$FAKE_STATE/app-up" ]]; then
  exit 8
fi
if [[ -e "$FAKE_STATE/require-caddy" && ! -e "$FAKE_STATE/caddy-up" ]]; then
  exit 9
fi
if [[ -f "$FAKE_STATE/http-code" ]]; then
  cat "$FAKE_STATE/http-code"
else
  printf '204'
fi
FAKE_CURL

  cat >"$CASE_ROOT/fake-bin/df" <<'FAKE_DF'
#!/usr/bin/env bash
set -euo pipefail
available='20000000'
[[ ! -f "$FAKE_STATE/free-kib" ]] || available="$(<"$FAKE_STATE/free-kib")"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/fake 30000000 1000000 %s 5%% /workspace\n' "$available"
FAKE_DF

  cat >"$CASE_ROOT/fake-bin/sleep" <<'FAKE_SLEEP'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep %s\n' "$*" >>"$FAKE_SLEEP_LOG"
FAKE_SLEEP

  cat >"$CASE_ROOT/fake-bin/mktemp" <<'FAKE_MKTEMP'
#!/usr/bin/env bash
set -euo pipefail
if [[ -e "$FAKE_STATE/mktemp-fails" ]]; then exit 73; fi
if [[ -e "$FAKE_STATE/state-write-fails" && "$*" == *'install.state.tmp.'* ]]; then
  path="$FAKE_STATE/state-temp-directory"
  mkdir -p "$path"
  printf '%s\n' "$path"
  exit 0
fi
for real_command in /usr/bin/mktemp /bin/mktemp; do
  if [[ -x "$real_command" ]]; then exec "$real_command" "$@"; fi
done
printf 'real mktemp executable not found\n' >&2
exit 127
FAKE_MKTEMP

  cat >"$CASE_ROOT/fake-bin/chmod" <<'FAKE_CHMOD'
#!/usr/bin/env bash
set -euo pipefail
if [[ -e "$FAKE_STATE/state-chmod-fails" && "$*" == *'install.state.tmp.'* ]]; then exit 74; fi
for real_command in /usr/bin/chmod /bin/chmod; do
  if [[ -x "$real_command" ]]; then exec "$real_command" "$@"; fi
done
printf 'real chmod executable not found\n' >&2
exit 127
FAKE_CHMOD

  cat >"$CASE_ROOT/fake-bin/mv" <<'FAKE_MV'
#!/usr/bin/env bash
set -euo pipefail
if [[ -e "$FAKE_STATE/state-mv-fails" && "$*" == *'install.state'* ]]; then exit 75; fi
for real_command in /usr/bin/mv /bin/mv; do
  if [[ -x "$real_command" ]]; then exec "$real_command" "$@"; fi
done
printf 'real mv executable not found\n' >&2
exit 127
FAKE_MV

  chmod 0700 "$CASE_ROOT/fake-bin/"*
}

make_fixture() {
  local name="$1"
  CASE_ROOT="$TEST_ROOT/$name"
  FAKE_STATE="$CASE_ROOT/fake-state"
  RUN_OUTPUT="$CASE_ROOT/run.out"
  RUN_STATUS=0

  mkdir -p "$CASE_ROOT/deploy" "$CASE_ROOT/scripts" "$FAKE_STATE"
  cp "$INSTALLER_SOURCE" "$CASE_ROOT/deploy/install.sh"
  cp "$LIBRARY_SOURCE" "$CASE_ROOT/deploy/install-lib.sh"
  printf 'services: {}\n' >"$CASE_ROOT/compose.yaml"
  printf ':80 {}\n' >"$CASE_ROOT/deploy/Caddyfile"
  printf 'console.log("seed")\n' >"$CASE_ROOT/scripts/seed-admin.ts"
  printf 'ID=debian\n' >"$CASE_ROOT/os-release"
  : >"$FAKE_STATE/volumes"
  : >"$FAKE_STATE/occupied-ports"
  write_fake_commands
}

run_install() {
  local input_file="$1"
  shift
  if (
    cd "$CASE_ROOT"
    env \
      PATH="$CASE_ROOT/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      INSTALL_ALLOW_NON_ROOT=1 \
      INSTALL_OS_RELEASE_FILE="$CASE_ROOT/os-release" \
      INSTALL_MIN_FREE_KIB=1000 \
      INSTALL_LOCK_PATH="$CASE_ROOT/install.lock" \
      INSTALL_POSTGRES_HEALTH_TIMEOUT_SECONDS="$TEST_POSTGRES_HEALTH_TIMEOUT_SECONDS" \
      INSTALL_WEB_HEALTH_TIMEOUT_SECONDS="$TEST_WEB_HEALTH_TIMEOUT_SECONDS" \
      INSTALL_PROBE_COMMAND_TIMEOUT_SECONDS="$TEST_PROBE_COMMAND_TIMEOUT_SECONDS" \
      FAKE_STATE="$FAKE_STATE" \
      FAKE_DOCKER_LOG="$FAKE_STATE/docker.log" \
      FAKE_CURL_LOG="$FAKE_STATE/curl.log" \
      FAKE_SLEEP_LOG="$FAKE_STATE/sleep.log" \
      timeout "$TEST_OUTER_TIMEOUT_SECONDS" bash deploy/install.sh "$@"
  ) <"$input_file" >"$RUN_OUTPUT" 2>&1; then
    RUN_STATUS=0
  else
    RUN_STATUS=$?
  fi
}

run_background_install() {
  local input_file="$1"
  local output_file="$2"
  shift 2
  (
    cd "$CASE_ROOT"
    env \
      PATH="$CASE_ROOT/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      INSTALL_ALLOW_NON_ROOT=1 \
      INSTALL_OS_RELEASE_FILE="$CASE_ROOT/os-release" \
      INSTALL_MIN_FREE_KIB=1000 \
      INSTALL_LOCK_PATH="$CASE_ROOT/install.lock" \
      INSTALL_POSTGRES_HEALTH_TIMEOUT_SECONDS="$TEST_POSTGRES_HEALTH_TIMEOUT_SECONDS" \
      INSTALL_WEB_HEALTH_TIMEOUT_SECONDS="$TEST_WEB_HEALTH_TIMEOUT_SECONDS" \
      INSTALL_PROBE_COMMAND_TIMEOUT_SECONDS="$TEST_PROBE_COMMAND_TIMEOUT_SECONDS" \
      FAKE_STATE="$FAKE_STATE" \
      FAKE_DOCKER_LOG="$FAKE_STATE/docker.log" \
      FAKE_CURL_LOG="$FAKE_STATE/curl.log" \
      FAKE_SLEEP_LOG="$FAKE_STATE/sleep.log" \
      timeout 15 bash deploy/install.sh "$@"
  ) <"$input_file" >"$output_file" 2>&1 &
  BACKGROUND_PID=$!
}

run_without_input() {
  local empty_input="$CASE_ROOT/empty.in"
  : >"$empty_input"
  run_install "$empty_input" "$@"
}

write_success_input() {
  local path="$1"
  local relay_key="${2:-relay-key-\$-#-visible}"
  local email="${3:-admin@example.com}"
  local password="${4:-visible-admin-password!}"
  printf '%s\n' "$relay_key" y "$email" "$password" "$password" y >"$path"
}

run_success_proxy_install() {
  local input_file="$CASE_ROOT/success.in"
  write_success_input "$input_file"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  assert_equal 0 "$RUN_STATUS" 'proxy installation should succeed'
}

test_cli_validation_stops_before_preflight_and_prompts() {
  make_fixture cli

  local -a cases=(
    ''
    '--unknown'
    '--domain'
    '--domain images.example.com --domain other.example.com'
    '--existing-proxy --existing-proxy --public-url https://images.example.com'
    '--domain images.example.com --existing-proxy --public-url https://images.example.com'
    '--existing-proxy --public-url https://images.example.com --public-url https://other.example.com'
    '--existing-proxy --public-url https://images.example.com --port 18081 --port 18082'
    '--resume --domain images.example.com'
  )
  local arguments output
  for arguments in "${cases[@]}"; do
    rm -f "$FAKE_STATE/docker.log"
    # These cases contain no shell metacharacters; word splitting intentionally models CLI arguments.
    # shellcheck disable=SC2086
    run_without_input $arguments
    [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion "invalid CLI should fail: $arguments"
    output="$(<"$RUN_OUTPUT")"
    assert_contains "$output" '用法' 'invalid CLI should print usage'
    assert_not_contains "$output" '请输入系统 Relay API Key' 'CLI failure must occur before prompts'
    [[ ! -e "$FAKE_STATE/docker.log" ]] || fail_assertion 'CLI failure must occur before Docker preflight'
  done
}

test_preflight_rejects_platform_disk_and_repo_before_prompts() {
  local output

  make_fixture preflight-platform
  printf 'ID=ubuntu\n' >"$CASE_ROOT/os-release"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'non-Debian host should fail'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'platform check must precede prompts'

  make_fixture preflight-disk
  printf '999\n' >"$FAKE_STATE/free-kib"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'low disk space should fail'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '磁盘' 'low disk failure should be clear'
  assert_not_contains "$output" '请输入系统 Relay API Key' 'disk check must precede prompts'

  make_fixture preflight-repo
  rm "$CASE_ROOT/scripts/seed-admin.ts"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'missing required repository file should fail'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'repository check must precede prompts'

  make_fixture preflight-docker
  touch "$FAKE_STATE/docker-info-fails"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'unavailable Docker daemon should fail'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'Docker check must precede prompts'
}

test_domain_validation_and_ports_stop_before_prompts() {
  local output

  make_fixture bad-domain
  run_without_input --domain 'https://images.example.com/path'
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'URL should not be accepted as a bare domain'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'domain validation must precede prompts'

  make_fixture domain-port
  printf '80\n' >"$FAKE_STATE/occupied-ports"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'occupied port 80 should reject domain mode'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '80' 'port conflict should identify port 80'
  assert_not_contains "$output" '请输入系统 Relay API Key' 'port conflict must precede prompts'

  make_fixture domain-port-443
  printf '443\n' >"$FAKE_STATE/occupied-ports"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'occupied port 443 should reject domain mode'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '443' 'port conflict should identify port 443'
  assert_not_contains "$output" '请输入系统 Relay API Key' 'port conflict must precede prompts'
}

test_proxy_url_and_port_validation() {
  local output

  make_fixture proxy-url
  run_without_input --existing-proxy --public-url http://images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'production proxy URL must use HTTPS'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'public URL validation must precede prompts'

  make_fixture proxy-missing-url
  run_without_input --existing-proxy
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'proxy mode requires a public URL'

  make_fixture proxy-port
  printf '18081\n' >"$FAKE_STATE/occupied-ports"
  run_without_input --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'occupied explicit proxy port should fail'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" '请输入系统 Relay API Key' 'explicit port validation must precede prompts'

  make_fixture proxy-invalid-port
  run_without_input --existing-proxy --public-url https://images.example.com --port 70000
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'out-of-range port should fail'
}

test_explicit_and_auto_selected_ports_are_rendered() {
  local input_file env_contents

  make_fixture explicit-port
  input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18091
  assert_equal 0 "$RUN_STATUS" 'explicit free port install should succeed'
  env_contents="$(<"$CASE_ROOT/deploy/.env.production")"
  assert_contains "$env_contents" 'WEB_HOST_PORT="18091"' 'explicit port should be persisted'

  make_fixture auto-port
  printf '18080\n' >"$FAKE_STATE/occupied-ports"
  input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com
  assert_equal 0 "$RUN_STATUS" 'auto-selected port install should succeed'
  env_contents="$(<"$CASE_ROOT/deploy/.env.production")"
  assert_contains "$env_contents" 'WEB_HOST_PORT="18081"' 'first free loopback port should be persisted'
}

test_fresh_state_guard_refuses_env_state_and_volumes_without_mutation() {
  local output before_hash

  make_fixture existing-env
  printf 'preserve-me\n' >"$CASE_ROOT/deploy/.env.production"
  before_hash="$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'existing env should reject fresh install'
  [[ ! -e "$FAKE_STATE/openssl-called" ]] || fail_assertion 'fresh guard must run before secret generation'
  assert_equal "$before_hash" "$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')" 'existing env bytes must be preserved'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '--resume' 'fresh guard should explain resume'
  assert_not_contains "$output" '请输入系统 Relay API Key' 'fresh guard must precede prompts'

  make_fixture existing-state
  printf 'preserve-state\n' >"$CASE_ROOT/deploy/install.state"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'existing state should reject fresh install'
  [[ ! -e "$FAKE_STATE/openssl-called" ]] || fail_assertion 'state guard must run before secret generation'
  assert_equal 'preserve-state' "$(<"$CASE_ROOT/deploy/install.state")" 'existing state bytes must be preserved'

  make_fixture existing-volume
  printf 'ai-image-workshop_media_data\n' >"$FAKE_STATE/volumes"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'existing media volume should reject fresh install'
  [[ ! -e "$FAKE_STATE/openssl-called" ]] || fail_assertion 'volume guard must run before secret generation'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '--resume' 'volume guard should explain resume'
  assert_not_contains "$output" '请输入系统 Relay API Key' 'volume guard must precede prompts'

  make_fixture existing-postgres-volume
  printf 'ai-image-workshop_postgres_data\n' >"$FAKE_STATE/volumes"
  run_without_input --domain images.example.com
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'existing postgres volume should reject fresh install'
  [[ ! -e "$FAKE_STATE/openssl-called" ]] || fail_assertion 'postgres volume guard must run before secret generation'
}

test_proxy_install_runs_exact_order_and_writes_private_files() {
  make_fixture full-proxy
  run_success_proxy_install

  local docker_log env_contents state_contents output success_tail
  docker_log="$(<"$FAKE_STATE/docker.log")"
  env_contents="$(<"$CASE_ROOT/deploy/.env.production")"
  state_contents="$(<"$CASE_ROOT/deploy/install.state")"
  output="$(<"$RUN_OUTPUT")"
  success_tail="${output#*部署完成。}"

  assert_ordered "$docker_log" \
    'docker info' \
    'docker compose version' \
    'docker volume inspect ai-image-workshop_postgres_data' \
    'docker volume inspect ai-image-workshop_media_data' \
    'docker compose --env-file deploy/.env.production config --quiet' \
    'docker compose --env-file deploy/.env.production up -d postgres' \
    'docker compose --env-file deploy/.env.production exec -T postgres pg_isready' \
    'docker compose --env-file deploy/.env.production build web' \
    'docker compose --env-file deploy/.env.production run --rm -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS web npm run db:migrate:production' \
    'docker compose --env-file deploy/.env.production run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD web node --import tsx scripts/seed-admin.ts' \
    'docker compose --env-file deploy/.env.production exec -T postgres psql' \
    'docker compose --env-file deploy/.env.production up -d web worker scheduler'

  local compose_line
  while IFS= read -r compose_line; do
    [[ "$compose_line" != 'docker compose version' ]] || continue
    [[ "$compose_line" == 'docker compose --env-file deploy/.env.production '* ]] \
      || fail_assertion 'every operational Compose command must use the production env file'
  done < <(grep '^docker compose ' "$FAKE_STATE/docker.log")

  assert_not_contains "$docker_log" 'visible-admin-password' 'command log must not contain the admin password'
  assert_not_contains "$docker_log" 'relay-key' 'command log must not contain the relay key'
  assert_equal '600' "$(stat -c '%a' "$CASE_ROOT/deploy/.env.production")" 'production env should be mode 600'
  assert_equal '600' "$(stat -c '%a' "$CASE_ROOT/deploy/install.state")" 'install state should be mode 600'
  assert_contains "$env_contents" 'POSTGRES_PASSWORD="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' 'generated database password should be rendered'
  assert_contains "$env_contents" 'BETTER_AUTH_SECRET="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"' 'generated auth secret should be rendered'
  assert_contains "$env_contents" 'RELAY_API_KEY="relay-key-$$-#-visible"' 'relay key should be Compose-escaped in env'
  assert_not_contains "$env_contents" 'ADMIN_EMAIL' 'admin email must not be persisted in env'
  assert_not_contains "$env_contents" 'ADMIN_PASSWORD' 'admin password must not be persisted in env'
  assert_contains "$state_contents" 'STAGE="complete"' 'state should reach complete'
  assert_contains "$state_contents" 'ADMIN_EMAIL="admin@example.com"' 'state may retain the admin email'
  assert_not_contains "$state_contents" 'relay-key' 'state must not contain relay key'
  assert_not_contains "$state_contents" 'visible-admin-password' 'state must not contain admin password'
  assert_not_contains "$state_contents" 'aaaaaaaaaaaaaaaa' 'state must not contain generated secrets'
  [[ -f "$FAKE_STATE/seed-env-present" ]] || fail_assertion 'seed command should receive transient admin variables'
  [[ -f "$FAKE_STATE/seed-env-cleared" ]] || fail_assertion 'admin seed variables should be absent for role verification'
  assert_not_contains "$docker_log" '--profile caddy' 'proxy mode must not start Caddy'
  assert_contains "$output" 'https://images.example.com/admin/login' 'success output should show admin login'
  assert_contains "$output" 'http://127.0.0.1:18081' 'proxy success output should show loopback upstream'
  assert_not_contains "$success_tail" 'relay-key' 'success summary must not show the relay key'
  assert_not_contains "$success_tail" 'visible-admin-password' 'success summary must not show the admin password'
}

test_domain_install_starts_caddy_and_reports_public_url() {
  make_fixture full-domain
  local input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  run_install "$input_file" --domain images.example.com
  assert_equal 0 "$RUN_STATUS" 'domain installation should succeed'

  local docker_log env_contents output
  docker_log="$(<"$FAKE_STATE/docker.log")"
  env_contents="$(<"$CASE_ROOT/deploy/.env.production")"
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$docker_log" 'docker compose --env-file deploy/.env.production --profile caddy up -d caddy' 'domain mode should start Caddy profile'
  assert_contains "$env_contents" 'COMPOSE_PROFILES="caddy"' 'domain env should enable Caddy'
  assert_contains "$env_contents" 'DOMAIN="images.example.com"' 'domain should be persisted'
  assert_contains "$env_contents" 'BETTER_AUTH_URL="https://images.example.com"' 'domain should determine public URL'
  assert_contains "$output" 'https://images.example.com/admin/login' 'domain output should show admin login'
  assert_not_contains "$output" '上游地址' 'domain output should not show proxy upstream guidance'
}

test_health_requires_exact_http_204() {
  make_fixture health-code
  printf '200' >"$FAKE_STATE/http-code"
  local input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'HTTP 200 must not satisfy the 204 health contract'
  assert_contains "$(<"$RUN_OUTPUT")" 'sudo bash deploy/install.sh --resume' 'health failure should print exact resume command'
  assert_equal '180' "$(wc -l <"$FAKE_STATE/curl.log" | tr -d ' ')" 'health poll should stop after 180 attempts'
}

test_failure_diagnostics_redact_all_secrets() {
  make_fixture diagnostics
  printf 'db:migrate:production' >"$FAKE_STATE/fail-match"
  local admin_password='diagnostic-admin-password!'
  local relay_key='diagnostic-relay-key'
  printf '%s\n' \
    "$relay_key" \
    "$admin_password" \
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
    >"$FAKE_STATE/service-logs"
  local input_file="$CASE_ROOT/input"
  write_success_input "$input_file" "$relay_key" admin@example.com "$admin_password"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'forced migration failure should fail installation'

  local output diagnostics docker_log
  output="$(<"$RUN_OUTPUT")"
  diagnostics="${output#*部署未完成。}"
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_contains "$docker_log" 'docker compose --env-file deploy/.env.production ps' 'failure should collect Compose status'
  assert_contains "$docker_log" 'docker compose --env-file deploy/.env.production logs --tail 100 web' 'failure should collect relevant logs'
  assert_contains "$diagnostics" '[REDACTED]' 'diagnostics should visibly redact secrets'
  assert_contains "$output" 'sudo bash deploy/install.sh --resume' 'diagnostics should print exact resume command'
  assert_not_contains "$diagnostics" "$relay_key" 'diagnostics must redact relay key'
  assert_not_contains "$diagnostics" "$admin_password" 'diagnostics must redact admin password'
  assert_not_contains "$diagnostics" 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' 'diagnostics must redact database password'
  assert_not_contains "$diagnostics" 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' 'diagnostics must redact generated base64 secrets'
}

test_seed_failure_redacts_password_and_preserves_exit_status() {
  make_fixture seed-secret-failure
  : >"$FAKE_STATE/seed-fails-with-secret"
  local admin_password='seed-output-password!'
  local input_file="$CASE_ROOT/input"
  write_success_input "$input_file" 'seed-failure-relay-key' admin@example.com "$admin_password"
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  assert_equal 92 "$RUN_STATUS" 'seed failure should preserve the Compose exit status'

  local output state_contents
  output="$(<"$RUN_OUTPUT")"
  state_contents="$(<"$CASE_ROOT/deploy/install.state")"
  assert_contains "$output" '[REDACTED]' 'seed output and diagnostics should show redaction markers'
  assert_not_contains "$output" "$admin_password" 'seed stdout, stderr, and diagnostics must not reveal admin password'
  assert_contains "$state_contents" 'STAGE="migrated"' 'seed failure should remain at migrated stage'
  assert_not_contains "$state_contents" "$admin_password" 'seed failure state must not persist admin password'
}

test_completed_resume_preserves_env_and_skips_all_secret_prompts() {
  make_fixture resume-complete
  run_success_proxy_install
  local before_hash
  before_hash="$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')"
  rm -f "$FAKE_STATE/postgres-up" "$FAKE_STATE/app-up"
  : >"$FAKE_STATE/require-runtime-start"
  : >"$FAKE_STATE/docker.log"
  : >"$FAKE_STATE/curl.log"

  run_without_input --resume
  assert_equal 0 "$RUN_STATUS" 'completed deployment resume should succeed without input'
  assert_equal "$before_hash" "$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')" 'resume must not rotate or rewrite env'
  local output docker_log
  output="$(<"$RUN_OUTPUT")"
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_not_contains "$output" 'Relay API Key' 'resume must never prompt for relay key'
  assert_not_contains "$output" '请输入管理员邮箱' 'completed resume must not prompt for admin email'
  assert_not_contains "$docker_log" 'seed-admin.ts' 'completed resume must not reseed admin'
  assert_contains "$docker_log" 'docker compose --env-file deploy/.env.production config --quiet' 'resume should validate Compose config'
  assert_ordered "$docker_log" \
    'docker compose --env-file deploy/.env.production up -d postgres' \
    'docker compose --env-file deploy/.env.production exec -T postgres pg_isready' \
    'docker compose --env-file deploy/.env.production exec -T postgres psql' \
    'docker compose --env-file deploy/.env.production up -d web worker scheduler'
  assert_contains "$docker_log" 'docker compose --env-file deploy/.env.production exec -T postgres psql' 'resume should verify both admin roles'
  assert_contains "$output" 'https://images.example.com/admin/login' 'completed resume should print success output'
}

test_completed_domain_resume_restarts_caddy_without_rebuilding() {
  make_fixture resume-complete-domain
  local input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  run_install "$input_file" --domain images.example.com
  assert_equal 0 "$RUN_STATUS" 'initial domain installation should succeed'
  local before_hash
  before_hash="$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')"

  rm -f "$FAKE_STATE/postgres-up" "$FAKE_STATE/app-up" "$FAKE_STATE/caddy-up"
  : >"$FAKE_STATE/require-runtime-start"
  : >"$FAKE_STATE/require-caddy"
  : >"$FAKE_STATE/docker.log"
  : >"$FAKE_STATE/curl.log"
  run_without_input --resume
  assert_equal 0 "$RUN_STATUS" 'completed domain resume should recreate runtime containers'
  assert_equal "$before_hash" "$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')" 'domain resume must preserve env bytes'

  local docker_log
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_ordered "$docker_log" \
    'docker compose --env-file deploy/.env.production up -d postgres' \
    'docker compose --env-file deploy/.env.production exec -T postgres pg_isready' \
    'docker compose --env-file deploy/.env.production exec -T postgres psql' \
    'docker compose --env-file deploy/.env.production up -d web worker scheduler' \
    'docker compose --env-file deploy/.env.production --profile caddy up -d caddy'
  assert_not_contains "$docker_log" 'build web' 'completed domain resume must not rebuild the image'
  assert_not_contains "$docker_log" 'db:migrate:production' 'completed domain resume must not rerun migrations'
  assert_not_contains "$docker_log" 'seed-admin.ts' 'completed domain resume must not reseed admin'
}

test_incomplete_admin_resume_prompts_only_admin_and_preserves_env() {
  make_fixture resume-admin
  printf 'scripts/seed-admin.ts' >"$FAKE_STATE/fail-match"
  local first_input="$CASE_ROOT/first.in"
  write_success_input "$first_input" 'resume-relay-key' old@example.com 'initial-admin-password!'
  run_install "$first_input" --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'forced seed failure should leave a resumable install'
  assert_contains "$(<"$CASE_ROOT/deploy/install.state")" 'STAGE="migrated"' 'failed seed should leave migrated stage'
  local before_hash
  before_hash="$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')"

  rm "$FAKE_STATE/fail-match"
  : >"$FAKE_STATE/docker.log"
  local resume_input="$CASE_ROOT/resume.in"
  printf '%s\n' new-admin@example.com 'resume-admin-password!' 'resume-admin-password!' >"$resume_input"
  run_install "$resume_input" --resume
  assert_equal 0 "$RUN_STATUS" 'incomplete admin stage should resume successfully'
  assert_equal "$before_hash" "$(sha256sum "$CASE_ROOT/deploy/.env.production" | awk '{print $1}')" 'admin resume must preserve env bytes'

  local output state_contents docker_log
  output="$(<"$RUN_OUTPUT")"
  state_contents="$(<"$CASE_ROOT/deploy/install.state")"
  docker_log="$(<"$FAKE_STATE/docker.log")"
  assert_not_contains "$output" 'Relay API Key' 'incomplete resume must not prompt for relay key'
  assert_ordered "$output" '请输入管理员邮箱' '请输入管理员密码' '请再次输入管理员密码'
  assert_not_contains "$output" '确认以上 Key' 'resume admin prompt must not request key confirmation'
  assert_contains "$docker_log" 'seed-admin.ts' 'incomplete resume should seed admin'
  assert_contains "$state_contents" 'ADMIN_EMAIL="new-admin@example.com"' 'resume should store the seeded admin email'
  assert_contains "$state_contents" 'STAGE="complete"' 'resume should finish all stages'
  assert_not_contains "$state_contents" 'resume-admin-password' 'state must not persist resumed password'
}

test_resume_rejects_unsafe_env_state_and_unknown_stage() {
  local output

  make_fixture resume-unsafe-env
  mkdir "$CASE_ROOT/deploy/.env.production"
  run_without_input --resume
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'directory env target should be rejected'
  output="$(<"$RUN_OUTPUT")"
  assert_not_contains "$output" 'Relay API Key' 'unsafe resume must not prompt for relay key'

  make_fixture resume-symlink-env
  printf 'outside\n' >"$CASE_ROOT/outside-env"
  ln -s "$CASE_ROOT/outside-env" "$CASE_ROOT/deploy/.env.production"
  run_without_input --resume
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'symlink env target should be rejected'

  make_fixture resume-mode-env
  run_success_proxy_install
  chmod 0644 "$CASE_ROOT/deploy/.env.production"
  run_without_input --resume
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'group/world-readable env should be rejected'

  make_fixture resume-unknown-stage
  run_success_proxy_install
  printf 'STATE_VERSION="1"\nSTAGE="invented"\nADMIN_EMAIL="admin@example.com"\n' >"$CASE_ROOT/deploy/install.state"
  chmod 0600 "$CASE_ROOT/deploy/install.state"
  : >"$FAKE_STATE/docker.log"
  run_without_input --resume
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'unknown install stage should be rejected'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" '状态' 'unknown state failure should be clear'
  assert_not_contains "$output" 'Relay API Key' 'unknown state must not trigger key prompt'
  assert_not_contains "$(<"$FAKE_STATE/docker.log")" ' up ' 'unknown state must not start containers'

  make_fixture resume-symlink-state
  run_success_proxy_install
  mv "$CASE_ROOT/deploy/install.state" "$CASE_ROOT/outside-state"
  ln -s "$CASE_ROOT/outside-state" "$CASE_ROOT/deploy/install.state"
  run_without_input --resume
  [[ "$RUN_STATUS" -ne 0 ]] || fail_assertion 'symlink state target should be rejected'
}

test_concurrent_installer_is_rejected_before_prompts_or_writes() {
  make_fixture concurrent-install
  : >"$FAKE_STATE/docker-info-blocks"
  local empty_input="$CASE_ROOT/empty.in"
  local first_output="$CASE_ROOT/first.out"
  : >"$empty_input"

  BACKGROUND_PID=''
  run_background_install "$empty_input" "$first_output" \
    --existing-proxy --public-url https://images.example.com --port 18081

  local _
  for _ in {1..50}; do
    [[ -f "$FAKE_STATE/docker.log" ]] && grep -Fxq 'docker info' "$FAKE_STATE/docker.log" && break
    /bin/sleep 0.1
  done
  [[ -n "$BACKGROUND_PID" && -f "$FAKE_STATE/docker.log" ]] || fail_assertion 'first installer should reach Docker preflight while holding the lock'

  TEST_OUTER_TIMEOUT_SECONDS=3
  run_without_input --existing-proxy --public-url https://images.example.com --port 18081
  local second_output
  second_output="$(<"$RUN_OUTPUT")"
  [[ "$RUN_STATUS" -ne 0 && "$RUN_STATUS" -ne 124 ]] || fail_assertion 'second installer should fail immediately instead of blocking in preflight'
  assert_contains "$second_output" '正在运行' 'second installer should report the active installation lock'
  assert_not_contains "$second_output" '请输入系统 Relay API Key' 'lock rejection must precede prompts'
  [[ ! -e "$CASE_ROOT/deploy/.env.production" && ! -e "$CASE_ROOT/deploy/install.state" ]] \
    || fail_assertion 'lock rejection must precede environment and state writes'
  assert_equal 1 "$(grep -Fxc 'docker info' "$FAKE_STATE/docker.log")" 'second installer must not start preflight'

  rm -f "$FAKE_STATE/docker-info-blocks"
  wait "$BACKGROUND_PID" || true
}

test_blocking_health_probes_respect_monotonic_deadlines() {
  local input_file output

  make_fixture postgres-deadline
  : >"$FAKE_STATE/postgres-probe-blocks"
  input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  TEST_OUTER_TIMEOUT_SECONDS=8
  TEST_POSTGRES_HEALTH_TIMEOUT_SECONDS=2
  TEST_PROBE_COMMAND_TIMEOUT_SECONDS=1
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 && "$RUN_STATUS" -ne 124 ]] || fail_assertion 'blocked PostgreSQL probe must fail within the installer deadline'
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" 'PostgreSQL' 'PostgreSQL deadline failure should be clear'
  assert_contains "$(<"$FAKE_STATE/docker.log")" 'pg_isready -U ai_image_workshop -d ai_image_workshop -t 1' 'PostgreSQL probe should bound pg_isready itself'

  make_fixture web-deadline
  : >"$FAKE_STATE/curl-blocks"
  input_file="$CASE_ROOT/input"
  write_success_input "$input_file"
  TEST_OUTER_TIMEOUT_SECONDS=8
  TEST_WEB_HEALTH_TIMEOUT_SECONDS=2
  TEST_PROBE_COMMAND_TIMEOUT_SECONDS=1
  run_install "$input_file" --existing-proxy --public-url https://images.example.com --port 18081
  [[ "$RUN_STATUS" -ne 0 && "$RUN_STATUS" -ne 124 ]] \
    || fail_assertion "blocked Web probe must fail within the installer deadline (status=$RUN_STATUS)"
  output="$(<"$RUN_OUTPUT")"
  assert_contains "$output" 'Web' 'Web deadline failure should be clear'
  assert_contains "$(<"$FAKE_STATE/curl.log")" '--connect-timeout' 'curl probe should bound connection setup'
  assert_contains "$(<"$FAKE_STATE/curl.log")" '--max-time' 'curl probe should bound the complete request'
}

test_state_write_failures_propagate_inside_conditionals() {
  local marker output status state_before
  local -a markers=(mktemp-fails state-write-fails state-chmod-fails state-mv-fails)

  for marker in "${markers[@]}"; do
    make_fixture "state-$marker"
    printf 'STATE_VERSION="1"\nSTAGE="configured"\n' >"$CASE_ROOT/deploy/install.state"
    chmod 0600 "$CASE_ROOT/deploy/install.state"
    state_before="$(sha256sum "$CASE_ROOT/deploy/install.state" | awk '{print $1}')"
    : >"$FAKE_STATE/$marker"
    sed '$d' "$CASE_ROOT/deploy/install.sh" >"$CASE_ROOT/deploy/install-functions.sh"

    output="$CASE_ROOT/state-write.out"
    if (
      cd "$CASE_ROOT"
      export PATH="$CASE_ROOT/fake-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      export FAKE_STATE
      # Calling in an if condition disables Bash errexit inside functions; explicit checks must still propagate.
      # Generated from the fixture installer above.
      # shellcheck disable=SC1091
      source deploy/install-functions.sh
      if write_install_state postgres_ready; then exit 0; else exit $?; fi
    ) >"$output" 2>&1; then
      status=0
    else
      status=$?
    fi

    [[ "$status" -ne 0 ]] || fail_assertion "$marker must propagate a state write failure from conditional context"
    assert_equal "$state_before" "$(sha256sum "$CASE_ROOT/deploy/install.state" | awk '{print $1}')" "$marker must preserve the previous state file"
  done
}

run_test 'CLI validation before preflight and prompts' test_cli_validation_stops_before_preflight_and_prompts
run_test 'platform, disk, Docker, and repository preflight' test_preflight_rejects_platform_disk_and_repo_before_prompts
run_test 'domain and 80/443 validation before prompts' test_domain_validation_and_ports_stop_before_prompts
run_test 'proxy public URL and port validation' test_proxy_url_and_port_validation
run_test 'explicit and automatic loopback port selection' test_explicit_and_auto_selected_ports_are_rendered
run_test 'fresh state and volume mutation guard' test_fresh_state_guard_refuses_env_state_and_volumes_without_mutation
run_test 'proxy command order and private state' test_proxy_install_runs_exact_order_and_writes_private_files
run_test 'domain Caddy startup and output' test_domain_install_starts_caddy_and_reports_public_url
run_test 'strict HTTP 204 health contract' test_health_requires_exact_http_204
run_test 'failure diagnostics secret redaction' test_failure_diagnostics_redact_all_secrets
run_test 'seed failure output redaction and status propagation' test_seed_failure_redacts_password_and_preserves_exit_status
run_test 'completed resume without secret prompts or rotation' test_completed_resume_preserves_env_and_skips_all_secret_prompts
run_test 'completed domain resume recreates runtime containers' test_completed_domain_resume_restarts_caddy_without_rebuilding
run_test 'incomplete admin resume prompts and continuation' test_incomplete_admin_resume_prompts_only_admin_and_preserves_env
run_test 'unsafe resume files and unknown state rejection' test_resume_rejects_unsafe_env_state_and_unknown_stage
run_test 'exclusive installer lock before prompts and writes' test_concurrent_installer_is_rejected_before_prompts_or_writes
run_test 'bounded blocking health probes' test_blocking_health_probes_respect_monotonic_deadlines
run_test 'conditional state write error propagation' test_state_write_failures_propagate_inside_conditionals

if ((FAIL_COUNT > 0)); then
  printf '%d installer test(s) failed\n' "$FAIL_COUNT" >&2
  exit 1
fi

printf 'all %d installer tests passed\n' "$PASS_COUNT"
