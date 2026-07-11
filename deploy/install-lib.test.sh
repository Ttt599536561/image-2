#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2016,SC2034,SC2153,SC2329
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LIBRARY_PATH="$SCRIPT_DIR/install-lib.sh"

if [[ ! -f "$LIBRARY_PATH" ]]; then
  printf 'not ok - deployment helper library exists\n' >&2
  exit 1
fi

# shellcheck source=deploy/install-lib.sh
source "$LIBRARY_PATH"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT HUP INT TERM

PASS_COUNT=0
FAIL_COUNT=0

fail_assertion() {
  printf 'assertion failed: %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [[ "$actual" == "$expected" ]] || fail_assertion "$message"
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
    [[ "$remaining" == *"$expected"* ]] || fail_assertion "prompt sequence is missing an item"
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

test_validate_email() {
  validate_email 'admin@example.com' || fail_assertion 'ordinary email should be valid'
  validate_email 'admin+deploy@sub.example.co' || fail_assertion 'tagged email should be valid'

  local invalid
  for invalid in '' 'admin' '@example.com' 'admin@' 'admin@example' 'admin@@example.com' \
    'admin @example.com' 'admin@-example.com' 'admin@example-.com' 'admin@example..com'; do
    if validate_email "$invalid"; then
      fail_assertion 'invalid email should be rejected'
    fi
  done
}

test_validate_password_byte_limits() {
  local ascii_72 ascii_73 unicode_72 unicode_75
  printf -v ascii_72 '%072d' 0
  printf -v ascii_73 '%073d' 0
  unicode_72=''
  unicode_75=''
  local index
  for ((index = 0; index < 24; index += 1)); do
    unicode_72+=$'\xE4\xB8\xAD'
  done
  unicode_75="${unicode_72}"$'\xE4\xB8\xAD'

  ! validate_password '12345' || fail_assertion 'five bytes should be rejected'
  validate_password '123456' || fail_assertion 'six bytes should be accepted'
  validate_password "$ascii_72" || fail_assertion '72 ASCII bytes should be accepted'
  ! validate_password "$ascii_73" || fail_assertion '73 ASCII bytes should be rejected'
  validate_password "$unicode_72" || fail_assertion '72 UTF-8 bytes should be accepted'
  ! validate_password "$unicode_75" || fail_assertion '75 UTF-8 bytes should be rejected'
}

test_confirm_yes_defaults_to_no() {
  confirm_yes 'continue' <<< 'y' >/dev/null || fail_assertion 'lowercase y should confirm'
  confirm_yes 'continue' <<< 'Y' >/dev/null || fail_assertion 'uppercase Y should confirm'
  if confirm_yes 'continue' <<< '' >/dev/null; then
    fail_assertion 'empty confirmation should reject'
  fi
  if confirm_yes 'continue' <<< 'yes' >/dev/null; then
    fail_assertion 'only an explicit y should confirm'
  fi
}

test_collect_install_inputs_visible_sequence() {
  local input_file="$TEST_ROOT/collect-success.in"
  local output_file="$TEST_ROOT/collect-success.out"
  local relay_key='relay-key-$-#-visible'
  local password='visible-admin-password!'
  printf '%s\n' "$relay_key" y 'admin@example.com' "$password" "$password" y >"$input_file"

  MODE_LABEL='内置 Caddy（images.example.com）'
  collect_install_inputs <"$input_file" >"$output_file" 2>&1

  assert_equal "$relay_key" "$RELAY_API_KEY" 'relay key global should be preserved exactly'
  assert_equal 'admin@example.com' "$ADMIN_EMAIL" 'admin email global should be set'
  assert_equal "$password" "$ADMIN_PASSWORD" 'admin password global should be set'
  assert_equal "$password" "$ADMIN_PASSWORD_CONFIRM" 'password confirmation global should be set'

  local output
  output="$(<"$output_file")"
  assert_ordered "$output" \
    '请输入系统 Relay API Key' \
    "系统 Relay API Key（完整）：$relay_key" \
    '确认以上 Key' \
    '请输入管理员邮箱' \
    '请输入管理员密码' \
    '请再次输入管理员密码' \
    '部署模式：内置 Caddy（images.example.com）' \
    '管理员邮箱：admin@example.com' \
    '确认开始部署'
  assert_not_contains "$output" "$password" 'redirected output must not print the password'
}

test_collect_install_inputs_rejects_key_confirmation() {
  local input_file="$TEST_ROOT/collect-key-rejected.in"
  local output_file="$TEST_ROOT/collect-key-rejected.out"
  printf '%s\n' 'relay-key' n >"$input_file"
  MODE_LABEL='现有反向代理'
  if collect_install_inputs <"$input_file" >"$output_file" 2>&1; then
    fail_assertion 'rejected relay key should stop collection'
  fi
  local output
  output="$(<"$output_file")"
  assert_not_contains "$output" '请输入管理员邮箱' 'email prompt must not follow rejected key'
}

test_collect_install_inputs_rejects_mismatched_passwords() {
  local input_file="$TEST_ROOT/collect-mismatch.in"
  local output_file="$TEST_ROOT/collect-mismatch.out"
  printf '%s\n' 'relay-key' y 'admin@example.com' 'password-one' 'password-two' >"$input_file"
  MODE_LABEL='现有反向代理'
  if collect_install_inputs <"$input_file" >"$output_file" 2>&1; then
    fail_assertion 'mismatched passwords should stop collection'
  fi
  local output
  output="$(<"$output_file")"
  assert_contains "$output" '两次输入的管理员密码不一致' 'mismatch error should be clear'
  assert_not_contains "$output" 'password-one' 'first password must not be printed by the script'
  assert_not_contains "$output" 'password-two' 'second password must not be printed by the script'
}

test_collect_install_inputs_rejects_final_confirmation() {
  local input_file="$TEST_ROOT/collect-final-rejected.in"
  local output_file="$TEST_ROOT/collect-final-rejected.out"
  printf '%s\n' 'relay-key' y 'admin@example.com' 'valid-password' 'valid-password' n >"$input_file"
  MODE_LABEL='现有反向代理'
  if collect_install_inputs <"$input_file" >"$output_file" 2>&1; then
    fail_assertion 'rejected final confirmation should stop collection'
  fi
}

test_collect_install_inputs_never_redirects_password() {
  local input_file="$TEST_ROOT/collect-no-password.in"
  local output_file="$TEST_ROOT/collect-no-password.out"
  local password='terminal-only-password!'
  printf '%s\n' 'relay-key' y 'admin@example.com' "$password" "$password" y >"$input_file"
  MODE_LABEL='现有反向代理'
  collect_install_inputs <"$input_file" >"$output_file" 2>&1
  local output
  output="$(<"$output_file")"
  assert_not_contains "$output" "$password" 'password must not appear in redirected output'
}

test_dotenv_quote_and_safe_load_round_trip() {
  local env_file="$TEST_ROOT/round-trip.env"
  local marker="$TEST_ROOT/command-was-executed"
  local original
  original="spaces # dollar \$HOME command \$(touch $marker) backslash \\ and single ' quote"
  local quoted
  quoted="$(dotenv_quote "$original")"
  printf 'RELAY_API_KEY=%s\n' "$quoted" >"$env_file"

  unset RELAY_API_KEY
  load_deploy_env "$env_file"
  assert_equal "$original" "$RELAY_API_KEY" 'quoted dotenv value should round-trip exactly'
  [[ ! -e "$marker" ]] || fail_assertion 'dotenv loader must never execute command substitutions'

  if dotenv_quote $'line one\nline two' >/dev/null; then
    fail_assertion 'dotenv quoting must reject newline characters'
  fi
  if dotenv_quote $'line one\rline two' >/dev/null; then
    fail_assertion 'dotenv quoting must reject carriage returns'
  fi
}

test_dotenv_quote_matches_compose_rules() {
  local slash_value='a\b'
  local trailing_slash="ends\\"
  local double_quote='a"b'
  local single_quote="a'b"
  local dollar_value='$HOME $(literal)'
  assert_equal '"a\\b"' "$(dotenv_quote "$slash_value")" 'backslash must use the Compose double-quote escape'
  assert_equal '"ends\\"' "$(dotenv_quote "$trailing_slash")" 'trailing backslash must remain representable'
  assert_equal '"a\"b"' "$(dotenv_quote "$double_quote")" 'double quote must use the Compose escape'
  assert_equal "\"a'b\"" "$(dotenv_quote "$single_quote")" 'single quote should remain literal in double quotes'
  assert_equal '"$$HOME $$(literal)"' "$(dotenv_quote "$dollar_value")" 'dollar signs must disable Compose interpolation'
  assert_equal "$slash_value" "$(dotenv_unquote '"a\\b"')" 'loader must decode an escaped backslash'
  assert_equal "$trailing_slash" "$(dotenv_unquote '"ends\\"')" 'loader must decode a trailing backslash'
  assert_equal "$double_quote" "$(dotenv_unquote '"a\"b"')" 'loader must decode an escaped double quote'
  assert_equal "$single_quote" "$(dotenv_unquote "\"a'b\"")" 'loader must preserve a single quote'
  assert_equal "$dollar_value" "$(dotenv_unquote '"$$HOME $$(literal)"')" 'loader must decode escaped dollar signs'
}

test_load_deploy_env_rejects_unknown_malformed_and_unquoted_code() {
  local env_file="$TEST_ROOT/rejected.env"
  local marker="$TEST_ROOT/unquoted-command-was-executed"

  printf 'UNKNOWN_DEPLOY_KEY=value\n' >"$env_file"
  if load_deploy_env "$env_file" >/dev/null 2>&1; then
    fail_assertion 'unknown dotenv key should be rejected'
  fi

  printf 'RELAY_API_KEY\n' >"$env_file"
  if load_deploy_env "$env_file" >/dev/null 2>&1; then
    fail_assertion 'malformed dotenv line should be rejected'
  fi

  printf 'RELAY_API_KEY=$(touch %s)\n' "$marker" >"$env_file"
  if load_deploy_env "$env_file" >/dev/null 2>&1; then
    fail_assertion 'unquoted shell syntax should be rejected'
  fi
  [[ ! -e "$marker" ]] || fail_assertion 'rejected dotenv text must not execute'

  printf "RELAY_API_KEY='first'\nRELAY_API_KEY='second'\n" >"$env_file"
  if load_deploy_env "$env_file" >/dev/null 2>&1; then
    fail_assertion 'duplicate dotenv keys should be rejected'
  fi
}

test_port_detection_and_selection() {
  ss() {
    if [[ "$*" == *':18080'* ]]; then
      printf 'LISTEN 0 128 127.0.0.1:18080 0.0.0.0:*\n'
    fi
  }
  export -f ss
  ! port_is_free 18080 || fail_assertion 'listening port should be occupied'
  port_is_free 18081 || fail_assertion 'port absent from ss output should be free'

  port_is_free() {
    [[ "$1" -eq 18083 ]]
  }
  local selected
  selected="$(find_free_port)"
  assert_equal '18083' "$selected" 'first free port should be selected'

  port_is_free() {
    return 1
  }
  if find_free_port >/dev/null 2>&1; then
    fail_assertion 'exhausted port range should fail'
  fi
}

test_random_secret_formats() {
  local hex_value base64url_value
  hex_value="$(random_hex 16)"
  base64url_value="$(random_base64url 32)"

  [[ ${#hex_value} -eq 32 ]] || fail_assertion '16 random bytes should produce 32 hex characters'
  [[ "$hex_value" =~ ^[0-9a-f]+$ ]] || fail_assertion 'hex secret should use lowercase hex only'
  [[ ${#base64url_value} -eq 43 ]] || fail_assertion '32 bytes should produce 43 unpadded base64url characters'
  [[ "$base64url_value" =~ ^[A-Za-z0-9_-]+$ ]] || fail_assertion 'base64url secret has an invalid character'

  if random_hex 0 >/dev/null 2>&1; then
    fail_assertion 'zero random bytes should be rejected'
  fi
  if random_base64url invalid >/dev/null 2>&1; then
    fail_assertion 'non-numeric random byte count should be rejected'
  fi
}

test_render_production_env_is_complete_private_and_safe() {
  local env_file="$TEST_ROOT/rendered.env"
  local marker="$TEST_ROOT/render-command-was-executed"
  COMPOSE_PROJECT_NAME='ai-image-workshop'
  COMPOSE_PROFILES='caddy'
  IMAGE_TAG='latest'
  DOMAIN='images.example.com'
  WEB_BIND_ADDRESS='127.0.0.1'
  WEB_HOST_PORT='18080'
  POSTGRES_DB='ai_image_workshop'
  POSTGRES_USER='ai_image_workshop'
  POSTGRES_PASSWORD='0123456789abcdef0123456789abcdef'
  BETTER_AUTH_SECRET='auth-secret_$-#-safe'
  BETTER_AUTH_URL='https://images.example.com'
  RELAY_API_KEY="relay # \$HOME \$(touch $marker) \\ ' exact"
  RELAY_BASE_URL='https://api.tangguo.xin/v1'
  CUSTOM_KEY_JOB_ENCRYPTION_KEY='encryption_key-123'
  ADMIN_EMAIL='must-not-be-rendered@example.com'
  ADMIN_PASSWORD='must-not-be-rendered-password'
  ADMIN_PASSWORD_CONFIRM="$ADMIN_PASSWORD"

  printf 'old insecure content\n' >"$env_file"
  chmod 0644 "$env_file"
  render_production_env "$env_file"

  assert_equal '600' "$(stat -c '%a' "$env_file")" 'rendered dotenv file should have mode 600'
  [[ ! -e "$marker" ]] || fail_assertion 'rendering must not execute substitutions in values'

  local contents
  contents="$(<"$env_file")"
  assert_not_contains "$contents" 'ADMIN_EMAIL' 'admin email must not be persisted'
  assert_not_contains "$contents" 'ADMIN_PASSWORD' 'admin password must not be persisted'
  assert_not_contains "$contents" 'SEED_ADMIN' 'seed fields must not be persisted'
  assert_equal '22' "$(wc -l <"$env_file" | tr -d ' ')" 'rendered file should contain every production key exactly once'

  local required_key
  for required_key in \
    COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED \
    STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL \
    CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY; do
    grep -q "^${required_key}=" "$env_file" || fail_assertion 'rendered dotenv file is missing a required key'
  done

  local expected_relay="$RELAY_API_KEY"
  unset RELAY_API_KEY DATABASE_URL DATABASE_URL_UNPOOLED
  load_deploy_env "$env_file"
  assert_equal "$expected_relay" "$RELAY_API_KEY" 'rendered relay key should load exactly'
  assert_equal \
    'postgresql://ai_image_workshop:0123456789abcdef0123456789abcdef@postgres:5432/ai_image_workshop' \
    "$DATABASE_URL" \
    'database URL should target the internal PostgreSQL service'
  assert_equal "$DATABASE_URL" "$DATABASE_URL_UNPOOLED" 'both database URLs should match for local PostgreSQL'
  assert_equal 'pg' "$DATABASE_DRIVER" 'database driver should be pg'
  assert_equal 'local' "$STORAGE_DRIVER" 'storage driver should be local'
}

test_render_production_env_requires_caller_secrets() {
  local env_file="$TEST_ROOT/missing-secret.env"
  COMPOSE_PROJECT_NAME='ai-image-workshop'
  COMPOSE_PROFILES=''
  IMAGE_TAG='latest'
  DOMAIN=''
  WEB_BIND_ADDRESS='127.0.0.1'
  WEB_HOST_PORT='18080'
  POSTGRES_DB='ai_image_workshop'
  POSTGRES_USER='ai_image_workshop'
  unset POSTGRES_PASSWORD BETTER_AUTH_SECRET CUSTOM_KEY_JOB_ENCRYPTION_KEY
  BETTER_AUTH_URL='https://images.example.com'
  RELAY_API_KEY='relay-key'
  RELAY_BASE_URL='https://api.tangguo.xin/v1'

  if render_production_env "$env_file" >/dev/null 2>&1; then
    fail_assertion 'missing generated secrets should reject rendering'
  fi
  [[ ! -e "$env_file" ]] || fail_assertion 'failed rendering should not leave a target file'
}

run_test 'email validation' test_validate_email
run_test 'password UTF-8 byte limits' test_validate_password_byte_limits
run_test 'explicit y/N confirmation' test_confirm_yes_defaults_to_no
run_test 'visible input prompt sequence' test_collect_install_inputs_visible_sequence
run_test 'relay key confirmation rejection' test_collect_install_inputs_rejects_key_confirmation
run_test 'mismatched password rejection' test_collect_install_inputs_rejects_mismatched_passwords
run_test 'final confirmation rejection' test_collect_install_inputs_rejects_final_confirmation
run_test 'password absent from redirected output' test_collect_install_inputs_never_redirects_password
run_test 'dotenv quote and safe load round-trip' test_dotenv_quote_and_safe_load_round_trip
run_test 'Compose-compatible dotenv quote rules' test_dotenv_quote_matches_compose_rules
run_test 'unsafe dotenv input rejection' test_load_deploy_env_rejects_unknown_malformed_and_unquoted_code
run_test 'port detection and first-free selection' test_port_detection_and_selection
run_test 'random secret formats' test_random_secret_formats
run_test 'private complete production dotenv rendering' test_render_production_env_is_complete_private_and_safe
run_test 'required generated secrets' test_render_production_env_requires_caller_secrets

if ((FAIL_COUNT > 0)); then
  printf '%d deployment helper test(s) failed\n' "$FAIL_COUNT" >&2
  exit 1
fi

printf 'all %d deployment helper tests passed\n' "$PASS_COUNT"
