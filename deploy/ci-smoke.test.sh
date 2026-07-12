#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2016,SC2034
set -euo pipefail
set +x

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SMOKE_PATH="$SCRIPT_DIR/ci-smoke.sh"
COMPOSE_PATH="$PROJECT_ROOT/compose.yaml"
WORKFLOW_PATH="$PROJECT_ROOT/.github/workflows/ci.yml"
PACKAGE_PATH="$PROJECT_ROOT/package.json"
GITIGNORE_PATH="$PROJECT_ROOT/.gitignore"
DOCKERIGNORE_PATH="$PROJECT_ROOT/.dockerignore"

FAILURES=0

fail() {
  printf 'not ok - %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

pass() {
  printf 'ok - %s\n' "$1"
}

assert_contains() {
  local content="$1" expected="$2" message="$3"
  if [[ "$content" == *"$expected"* ]]; then
    pass "$message"
  else
    fail "$message"
  fi
}

assert_not_contains() {
  local content="$1" unexpected="$2" message="$3"
  if [[ "$content" != *"$unexpected"* ]]; then
    pass "$message"
  else
    fail "$message"
  fi
}

assert_ordered() {
  local content="$1" message="$2"
  shift 2
  local expected
  for expected in "$@"; do
    if [[ "$content" != *"$expected"* ]]; then
      fail "$message (missing: $expected)"
      return
    fi
    content="${content#*"$expected"}"
  done
  pass "$message"
}

assert_occurrences_at_least() {
  local content="$1" needle="$2" minimum="$3" message="$4"
  local count=0 remainder="$content"
  while [[ "$remainder" == *"$needle"* ]]; do
    count=$((count + 1))
    remainder="${remainder#*"$needle"}"
  done
  if ((count >= minimum)); then
    pass "$message"
  else
    fail "$message (expected at least $minimum, got $count)"
  fi
}

smoke=''
if [[ -f "$SMOKE_PATH" ]]; then
  smoke="$(<"$SMOKE_PATH")"
  pass 'ci smoke script exists'
else
  fail 'ci smoke script exists'
fi

compose="$(<"$COMPOSE_PATH")"
workflow="$(<"$WORKFLOW_PATH")"
package_json="$(<"$PACKAGE_PATH")"
gitignore="$(<"$GITIGNORE_PATH")"

assert_contains "$compose" 'path: deploy/.env.production' \
  'Compose always loads the fixed production environment path'
assert_not_contains "$compose" 'DEPLOY_ENV_FILE' \
  'host DEPLOY_ENV_FILE cannot redirect the base Compose environment'
assert_contains "$smoke" 'ai-image-workshop-ci-' 'smoke uses an isolated project prefix'
assert_contains "$smoke" 'docker compose --project-name' 'every smoke Compose call has an explicit project'
assert_contains "$smoke" '-f compose.yaml -f "$OVERRIDE_RELATIVE_PATH"' \
  'smoke always combines the fixed base file with its generated override'
assert_occurrences_at_least "$smoke" 'env_file: !override' 3 \
  'the generated override replaces app env files for web, worker, and scheduler'
assert_occurrences_at_least "$smoke" 'required: true' 3 \
  'all generated smoke env files are required'
assert_contains "$smoke" '--env-file deploy/.env.production.example' \
  'cleanup Compose interpolation uses the tracked production example'
assert_contains "$smoke" 'down --volumes --remove-orphans' 'cleanup removes only the isolated stack and volumes'
assert_contains "$smoke" 'trap cleanup EXIT' 'cleanup is installed as an EXIT trap'
assert_contains "$smoke" '3000, "127.0.0.1"' 'a Node server occupies host port 3000'
assert_contains "$smoke" 'createServer' 'Node net selects a free loopback port'
assert_contains "$smoke" 'listen(0' 'free-port selection asks the kernel for port zero'
assert_contains "$smoke" 'MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS' 'production migrations run in the smoke'
assert_contains "$smoke" 'SEED_ADMIN_EMAIL' 'the deterministic CI administrator is seeded'
assert_contains "$smoke" "CUSTOM_KEY_MODES_ENABLED 'true'" \
  'the real stack smoke enables the fresh-install custom key mode'
assert_contains "$smoke" 'assert_custom_mode_enabled' \
  'the real stack smoke verifies custom mode inside the running web service'
assert_contains "$smoke" 'encryptCustomApiKey' \
  'the real stack smoke verifies its generated encryption key with AES-GCM'
assert_contains "$smoke" 'FROM users' 'the business administrator role is verified'
assert_contains "$smoke" 'FROM \"user\"' 'the Better Auth administrator role is verified'
assert_contains "$smoke" 'new Uint8Array([1,2,3])' 'the smoke writes the three-byte media fixture'
assert_contains "$smoke" '--force-recreate' 'application containers are force-recreated'
assert_contains "$smoke" 'ps --status running --services' 'the exact running service set is checked'
assert_contains "$smoke" 'com.docker.compose.project' 'cleanup verifies project-labelled resources are gone'
assert_occurrences_at_least "$smoke" 'docker network ls -q --filter' 2 \
  'network labels are checked before startup and after cleanup'
assert_contains "$smoke" 'temporary smoke environment remains after cleanup' \
  'cleanup treats a retained secret environment file as failure'
assert_contains "$smoke" 'temporary smoke override remains after cleanup' \
  'cleanup treats a retained generated override as failure'
assert_ordered "$smoke" 'cleanup releases the host port and secrets before Docker cleanup' \
  'kill "$PORT_3000_PID"' \
  'wait "$PORT_3000_PID"' \
  'rm -f -- "$ENV_FILE" "$OVERRIDE_FILE"' \
  '"${CLEANUP_COMPOSE_COMMAND[@]}"'
assert_occurrences_at_least "$smoke" 'timeout --signal=KILL 10 docker' 9 \
  'Docker preflight and every project-label query are bounded'

assert_contains "$gitignore" 'deploy/.ci-smoke.*' \
  'Git ignores generated smoke environments and overrides'
if git -C "$PROJECT_ROOT" check-ignore -q deploy/.ci-smoke.contract.env; then
  pass 'git check-ignore confirms generated smoke files are ignored'
else
  fail 'git check-ignore confirms generated smoke files are ignored'
fi
if grep -Fxq 'deploy/.ci-smoke.*' "$DOCKERIGNORE_PATH"; then
  pass 'static Docker context excludes generated smoke environments and overrides'
else
  fail 'static Docker context excludes generated smoke environments and overrides'
fi

assert_ordered "$workflow" 'CI runs deployment contracts before the image build' \
  'Validate Docker Compose' \
  'Deployment script contract tests' \
  'Build Docker image'
assert_ordered "$workflow" 'CI runs the real smoke after runtime validation' \
  'Build Docker image' \
  'Validate Docker runtime dependencies' \
  'Empty self-hosted stack smoke'
assert_contains "$workflow" 'IMAGE_TAG: ci' 'CI smoke selects the prebuilt ci image tag'
assert_ordered "$workflow" 'deployment contract step is capped at five minutes' \
  '- name: Deployment script contract tests' \
  'timeout-minutes: 5' \
  'run: npm run test:deploy'
assert_ordered "$workflow" 'real deployment smoke is capped at ten minutes' \
  '- name: Empty self-hosted stack smoke' \
  'timeout-minutes: 10' \
  'run: npm run test:deploy:smoke'
assert_contains "$package_json" '"test:deploy:smoke": "bash deploy/ci-smoke.sh"' \
  'package exposes the real deployment smoke command'
assert_contains "$package_json" 'bash deploy/ci-smoke.test.sh' \
  'deployment contracts include the CI smoke static test'

run_cleanup_case() {
  local case_name="$1" original_status="$2" timeout_mode="$3" rm_mode="$4" remaining_mode="$5"
  local case_dir="$TEST_ROOT/$case_name"
  mkdir -p "$case_dir/bin"
  : >"$case_dir/log"
  : >"$case_dir/smoke.env"
  : >"$case_dir/smoke.override.yaml"

  cat >"$case_dir/bin/timeout" <<'FAKE_TIMEOUT'
#!/usr/bin/env bash
printf 'timeout:%s\n' "$*" >>"$CI_SMOKE_FAKE_LOG"
if [[ "$CI_SMOKE_FAKE_TIMEOUT_MODE" == fail ]]; then
  exit 124
fi
while (($# > 0)); do
  case "$1" in
    --signal=*) shift ;;
    [0-9]*) shift; break ;;
    *) break ;;
  esac
done
"$@"
FAKE_TIMEOUT
  cat >"$case_dir/bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
printf 'docker:%s\n' "$*" >>"$CI_SMOKE_FAKE_LOG"
case "$CI_SMOKE_FAKE_REMAINING:$1:${2:-}" in
  all:ps:*|all:volume:ls|all:network:ls) printf 'resource-id\n' ;;
esac
FAKE_DOCKER
  cat >"$case_dir/bin/rm" <<'FAKE_RM'
#!/usr/bin/env bash
printf 'rm:%s\n' "$*" >>"$CI_SMOKE_FAKE_LOG"
if [[ "$CI_SMOKE_FAKE_RM_MODE" == fail ]]; then
  exit 73
fi
exec "$CI_SMOKE_REAL_RM" "$@"
FAKE_RM
  chmod +x "$case_dir/bin/timeout" "$case_dir/bin/docker" "$case_dir/bin/rm"

  set +e
  (
    export PATH="$case_dir/bin:$PATH"
    export CI_SMOKE_FAKE_LOG="$case_dir/log"
    export CI_SMOKE_FAKE_TIMEOUT_MODE="$timeout_mode"
    export CI_SMOKE_FAKE_RM_MODE="$rm_mode"
    export CI_SMOKE_FAKE_REMAINING="$remaining_mode"
    export CI_SMOKE_REAL_RM="$REAL_RM"
    # shellcheck source=deploy/ci-smoke.sh
    source "$SMOKE_PATH"
    PROJECT_NAME='ai-image-workshop-ci-contract-12345'
    COMPOSE_CLEANUP_ALLOWED=1
    CLEANUP_COMPOSE_COMMAND=(docker compose --project-name "$PROJECT_NAME" \
      --env-file deploy/.env.production.example -f compose.yaml)
    ENV_FILE="$case_dir/smoke.env"
    OVERRIDE_FILE="$case_dir/smoke.override.yaml"
    PORT_3000_PID=''
    SMOKE_ASSERTIONS_PASSED=1
    set +e
    if ((original_status == 0)); then
      true
    else
      (exit "$original_status")
    fi
    cleanup
  ) >/dev/null 2>&1
  CLEANUP_CASE_STATUS=$?
  set -e
  CLEANUP_CASE_DIR="$case_dir"
}

if [[ "$smoke" == *'if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then'* ]]; then
  TEST_ROOT="$(mktemp -d)"
  REAL_RM="$(command -v rm)"
  trap '"$REAL_RM" -rf -- "$TEST_ROOT"' EXIT

  run_cleanup_case pass 0 pass pass none
  pass_log="$(<"$CLEANUP_CASE_DIR/log")"
  if ((CLEANUP_CASE_STATUS == 0)); then
    pass 'successful cleanup preserves a successful smoke status'
  else
    fail 'successful cleanup preserves a successful smoke status'
  fi
  assert_ordered "$pass_log" 'temporary files are deleted before cleanup Docker calls' \
    'rm:-f --' \
    'timeout:--signal=KILL 90 docker compose' \
    'timeout:--signal=KILL 10 docker ps' \
    'timeout:--signal=KILL 10 docker volume ls' \
    'timeout:--signal=KILL 10 docker network ls'

  run_cleanup_case rm-failure 0 pass fail none
  if ((CLEANUP_CASE_STATUS != 0)); then
    pass 'rm failure converts an otherwise successful smoke to failure'
  else
    fail 'rm failure converts an otherwise successful smoke to failure'
  fi

  run_cleanup_case timeout-original-status 42 fail pass none
  timeout_log="$(<"$CLEANUP_CASE_DIR/log")"
  if ((CLEANUP_CASE_STATUS == 42)); then
    pass 'the original nonzero smoke status wins over cleanup timeouts'
  else
    fail 'the original nonzero smoke status wins over cleanup timeouts'
  fi
  assert_occurrences_at_least "$timeout_log" 'timeout:--signal=KILL 10 docker' 3 \
    'all post-cleanup resource queries remain bounded when Docker times out'

  run_cleanup_case resources-remain 0 pass pass all
  if ((CLEANUP_CASE_STATUS != 0)); then
    pass 'remaining labelled containers, volumes, or networks fail a successful smoke'
  else
    fail 'remaining labelled containers, volumes, or networks fail a successful smoke'
  fi
else
  fail 'ci smoke exposes cleanup functions without running main when sourced'
fi

if ((FAILURES > 0)); then
  printf '%d CI smoke contract(s) failed\n' "$FAILURES" >&2
  exit 1
fi

printf 'CI smoke contract tests passed\n'
