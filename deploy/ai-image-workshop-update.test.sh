#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="$SCRIPT_DIR/ai-image-workshop-update"
REQUEST_ID='26e972ea-37e0-4361-8d03-52130c1c241b'
REQUESTED_BY='af9b6b12-530d-4388-91f2-4918fb793de5'
CASE_ROOTS=()

cleanup() {
  local root
  for root in "${CASE_ROOTS[@]}"; do
    rm -rf -- "$root"
  done
}

trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

new_case() {
  CASE_ROOT="$(mktemp -d)"
  CASE_ROOTS+=("$CASE_ROOT")
  PROJECT_ROOT="$CASE_ROOT/project"
  CONTROL_ROOT="$CASE_ROOT/control"
  CONFIG_PATH="$CASE_ROOT/updater.conf"
  FAKE_BIN="$CASE_ROOT/bin"

  mkdir -p \
    "$PROJECT_ROOT/deploy" \
    "$CONTROL_ROOT/inbox/.start-reservation" \
    "$CONTROL_ROOT/state" \
    "$CONTROL_ROOT/work" \
    "$FAKE_BIN"

  printf '{"version":"0.2.1"}\n' >"$PROJECT_ROOT/package.json"
  cat >"$PROJECT_ROOT/deploy/.env.production" <<EOF
COMPOSE_PROJECT_NAME=ai-image-workshop
IMAGE_TAG=latest
WEB_HOST_PORT=3000
POSTGRES_DB=ai_image_workshop
POSTGRES_USER=ai_image_workshop
UPDATER_CONTROL_ROOT=$CONTROL_ROOT
UPDATER_CONTROL_GID=1000
EOF
  chmod 0600 "$PROJECT_ROOT/deploy/.env.production"

  cat >"$CONFIG_PATH" <<EOF
PROJECT_ROOT=$PROJECT_ROOT
CONTROL_ROOT=$CONTROL_ROOT
EOF
  chmod 0600 "$CONFIG_PATH"

  for command_name in curl docker git; do
    cat >"$FAKE_BIN/$command_name" <<'EOF'
#!/usr/bin/env bash
exit 22
EOF
    chmod 0755 "$FAKE_BIN/$command_name"
  done

  local now_epoch
  now_epoch="$(date -u +%s)"
  REQUESTED_AT="$(date -u -d "@$now_epoch" +%Y-%m-%dT%H:%M:%S.000Z)"
  EXPIRES_AT="$(date -u -d "@$((now_epoch + 900))" +%Y-%m-%dT%H:%M:%S.000Z)"
}

write_request() {
  local duplicate_requested_by="${1:-false}"
  if [[ "$duplicate_requested_by" == true ]]; then
    printf \
      '{"protocolVersion":1,"requestId":"%s","requestedAt":"%s","requestedBy":"%s","requestedBy":"%s"}\n' \
      "$REQUEST_ID" "$REQUESTED_AT" "$REQUESTED_BY" "$REQUESTED_BY" \
      >"$CONTROL_ROOT/inbox/request.json"
  else
    jq -n \
      --arg requestId "$REQUEST_ID" \
      --arg requestedAt "$REQUESTED_AT" \
      --arg requestedBy "$REQUESTED_BY" \
      '{protocolVersion:1,requestId:$requestId,requestedAt:$requestedAt,requestedBy:$requestedBy}' \
      >"$CONTROL_ROOT/inbox/request.json"
  fi

  jq -n \
    --arg requestId "$REQUEST_ID" \
    --arg requestedAt "$REQUESTED_AT" \
    --arg expiresAt "$EXPIRES_AT" \
    '{protocolVersion:1,requestId:$requestId,requestedAt:$requestedAt,expiresAt:$expiresAt}' \
    >"$CONTROL_ROOT/inbox/.start-reservation/$REQUEST_ID.json"
  chmod 0600 \
    "$CONTROL_ROOT/inbox/request.json" \
    "$CONTROL_ROOT/inbox/.start-reservation/$REQUEST_ID.json"
}

run_updater() {
  PATH="$FAKE_BIN:$PATH" \
    AI_IMAGE_WORKSHOP_UPDATE_TEST_MODE=1 \
    AI_IMAGE_WORKSHOP_UPDATE_CONFIG="$CONFIG_PATH" \
    bash "$UPDATER" process-request
}

test_valid_request_is_claimed() {
  new_case
  write_request

  if run_updater; then
    fail 'the fake release check should make process-request fail'
  fi

  [[ -f "$CONTROL_ROOT/state/status.json" ]] || \
    fail 'a valid request never published updater status'
  jq -e --arg request_id "$REQUEST_ID" '
    .requestId == $request_id and
    .currentVersion == "0.2.1" and
    .phase == "failed" and
    .maintenance == false and
    .errorCode == "RELEASE_CHECK_FAILED"
  ' "$CONTROL_ROOT/state/status.json" >/dev/null || \
    fail 'a valid request did not reach the controlled release-check failure'
  [[ ! -e "$CONTROL_ROOT/inbox/request.json" ]] || \
    fail 'the claimed request remained in the inbox'
  [[ ! -e "$CONTROL_ROOT/inbox/.start-reservation" ]] || \
    fail 'the claimed reservation remained in the inbox'
}

test_duplicate_request_key_is_rejected() {
  new_case
  write_request true

  if run_updater; then
    fail 'a duplicate request key was accepted'
  fi

  [[ ! -e "$CONTROL_ROOT/state/status.json" ]] || \
    fail 'an invalid request published an active updater status'
  [[ -f "$CONTROL_ROOT/inbox/request.json" ]] || \
    fail 'an invalid request was claimed'
}

test_valid_request_is_claimed
test_duplicate_request_key_is_rejected
printf 'PASS: updater request validation\n'
