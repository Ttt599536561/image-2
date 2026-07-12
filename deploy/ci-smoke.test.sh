#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail
set +x

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SMOKE_PATH="$SCRIPT_DIR/ci-smoke.sh"
COMPOSE_PATH="$PROJECT_ROOT/compose.yaml"
WORKFLOW_PATH="$PROJECT_ROOT/.github/workflows/ci.yml"
PACKAGE_PATH="$PROJECT_ROOT/package.json"

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

assert_contains "$compose" '${DEPLOY_ENV_FILE:-deploy/.env.production}' \
  'Compose keeps the production env default while allowing an isolated smoke env'
assert_contains "$smoke" 'ai-image-workshop-ci-' 'smoke uses an isolated project prefix'
assert_contains "$smoke" 'docker compose --project-name' 'every smoke Compose call has an explicit project'
assert_contains "$smoke" 'down --volumes --remove-orphans' 'cleanup removes only the isolated stack and volumes'
assert_contains "$smoke" 'trap cleanup EXIT' 'cleanup is installed as an EXIT trap'
assert_contains "$smoke" '3000, "127.0.0.1"' 'a Node server occupies host port 3000'
assert_contains "$smoke" 'createServer' 'Node net selects a free loopback port'
assert_contains "$smoke" 'listen(0' 'free-port selection asks the kernel for port zero'
assert_contains "$smoke" 'MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS' 'production migrations run in the smoke'
assert_contains "$smoke" 'SEED_ADMIN_EMAIL' 'the deterministic CI administrator is seeded'
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

assert_ordered "$workflow" 'CI runs deployment contracts before the image build' \
  'Validate Docker Compose' \
  'Deployment script contract tests' \
  'Build Docker image'
assert_ordered "$workflow" 'CI runs the real smoke after runtime validation' \
  'Build Docker image' \
  'Validate Docker runtime dependencies' \
  'Empty self-hosted stack smoke'
assert_contains "$workflow" 'IMAGE_TAG: ci' 'CI smoke selects the prebuilt ci image tag'
assert_contains "$package_json" '"test:deploy:smoke": "bash deploy/ci-smoke.sh"' \
  'package exposes the real deployment smoke command'
assert_contains "$package_json" 'bash deploy/ci-smoke.test.sh' \
  'deployment contracts include the CI smoke static test'

if ((FAILURES > 0)); then
  printf '%d CI smoke contract(s) failed\n' "$FAILURES" >&2
  exit 1
fi

printf 'CI smoke contract tests passed\n'
