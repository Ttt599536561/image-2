#!/usr/bin/env bash
set +x
set -euo pipefail

die() {
  printf '错误：%s\n' "$*" >&2
  return 1
}

validate_email() {
  local email="${1-}"
  local byte_count
  byte_count="$(LC_ALL=C printf '%s' "$email" | wc -c)"
  ((byte_count > 0 && byte_count <= 254)) || return 1
  [[ "$email" != *[[:space:][:cntrl:]]* ]] || return 1
  [[ "$email" == *@* ]] || return 1

  local local_part="${email%@*}"
  local domain="${email##*@}"
  [[ -n "$local_part" && -n "$domain" ]] || return 1
  [[ "$local_part" != *@* ]] || return 1
  [[ "$local_part" != .* && "$local_part" != *. && "$local_part" != *..* ]] || return 1
  [[ "$local_part" != *[[:space:]@]* ]] || return 1

  local local_bytes
  local_bytes="$(LC_ALL=C printf '%s' "$local_part" | wc -c)"
  ((local_bytes <= 64)) || return 1

  [[ "$domain" == *.* ]] || return 1
  [[ "$domain" != .* && "$domain" != *. && "$domain" != *..* ]] || return 1
  [[ "$domain" != *[!A-Za-z0-9.-]* ]] || return 1

  local remainder="$domain"
  local label
  while [[ "$remainder" == *.* ]]; do
    label="${remainder%%.*}"
    remainder="${remainder#*.}"
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1
  done
  label="$remainder"
  [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1
}

canonicalize_email() {
  LC_ALL=C printf '%s' "${1-}" | tr '[:upper:]' '[:lower:]'
}

validate_password() {
  local password="${1-}"
  local byte_count
  byte_count="$(LC_ALL=C printf '%s' "$password" | wc -c)"
  ((byte_count >= 6 && byte_count <= 72))
}

confirm_yes() {
  local prompt="${1:-确认继续}"
  local answer=''
  printf '%s [y/N]：' "$prompt"
  IFS= read -r answer || return 1
  [[ "$answer" == 'y' || "$answer" == 'Y' ]]
}

dotenv_quote() {
  local value="${1-}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1

  local quoted='"'
  local character
  local index
  for ((index = 0; index < ${#value}; index += 1)); do
    character="${value:index:1}"
    case "$character" in
      \\)
        quoted+="\\\\"
        ;;
      '"')
        quoted+="\\\""
        ;;
      '$')
        quoted+='$$'
        ;;
      *)
        quoted+="$character"
        ;;
    esac
  done
  quoted+='"'
  printf '%s' "$quoted"
}

dotenv_unquote() {
  local encoded="${1-}"
  [[ "$encoded" != *$'\n'* && "$encoded" != *$'\r'* ]] || return 1

  if [[ ${#encoded} -ge 2 && "${encoded:0:1}" == '"' && "${encoded: -1}" == '"' ]]; then
    local inner="${encoded:1:${#encoded}-2}"
    local decoded=''
    local character next_character
    local index=0
    while ((index < ${#inner})); do
      character="${inner:index:1}"
      case "$character" in
        '"')
          return 1
          ;;
        \\)
          index=$((index + 1))
          ((index < ${#inner})) || return 1
          next_character="${inner:index:1}"
          case "$next_character" in
            \\ | '"')
              decoded+="$next_character"
              ;;
            *)
              return 1
              ;;
          esac
          ;;
        '$')
          index=$((index + 1))
          ((index < ${#inner})) || return 1
          [[ "${inner:index:1}" == '$' ]] || return 1
          decoded+='$'
          ;;
        *)
          decoded+="$character"
          ;;
      esac
      index=$((index + 1))
    done
    printf '%s' "$decoded"
    return 0
  fi

  [[ "$encoded" =~ ^[A-Za-z0-9_./:@+-]*$ ]] || return 1
  printf '%s' "$encoded"
}

_deploy_env_key_allowed() {
  case "$1" in
    COMPOSE_PROJECT_NAME | COMPOSE_PROFILES | IMAGE_TAG | DOMAIN | WEB_BIND_ADDRESS | WEB_HOST_PORT | \
      POSTGRES_DB | POSTGRES_USER | POSTGRES_PASSWORD | DATABASE_DRIVER | DATABASE_URL | \
      DATABASE_URL_UNPOOLED | STORAGE_DRIVER | LOCAL_STORAGE_ROOT | BETTER_AUTH_SECRET | \
      BETTER_AUTH_URL | RELAY_API_KEY | RELAY_BASE_URL | CUSTOM_KEY_JOB_ENCRYPTION_KEY | \
      CUSTOM_KEY_MODES_ENABLED | WORKER_CONCURRENCY | TRUST_PROXY)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

load_deploy_env() {
  local env_path="${1-}"
  [[ -n "$env_path" && -r "$env_path" ]] || {
    die "无法读取部署环境文件：$env_path"
    return 1
  }

  local -a keys=()
  local -a values=()
  local -A seen=()
  local line=''
  local line_number=0
  local key encoded decoded

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || {
      die "部署环境文件第 $line_number 行格式无效"
      return 1
    }

    key="${line%%=*}"
    encoded="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || {
      die "部署环境文件第 $line_number 行键名无效"
      return 1
    }
    _deploy_env_key_allowed "$key" || {
      die "部署环境文件包含未允许的键：$key"
      return 1
    }
    [[ ! ${seen[$key]+present} ]] || {
      die "部署环境文件包含重复的键：$key"
      return 1
    }
    if ! decoded="$(dotenv_unquote "$encoded")"; then
      die "部署环境文件第 $line_number 行值格式无效"
      return 1
    fi

    seen["$key"]=1
    keys+=("$key")
    values+=("$decoded")
  done <"$env_path"

  local index
  for ((index = 0; index < ${#keys[@]}; index += 1)); do
    printf -v "${keys[index]}" '%s' "${values[index]}"
    export "${keys[index]}"
  done
}

port_is_free() {
  local port="${1-}"
  [[ "$port" =~ ^[0-9]+$ ]] || return 2
  ((port >= 1 && port <= 65535)) || return 2

  local listeners
  if ! listeners="$(ss -H -ltn "sport = :$port" 2>/dev/null)"; then
    return 2
  fi
  [[ -z "$listeners" ]]
}

find_free_port() {
  local port
  for ((port = 18080; port <= 18180; port += 1)); do
    if port_is_free "$port"; then
      printf '%s\n' "$port"
      return 0
    fi
  done
  die '18080-18180 范围内没有可用端口'
}

_validate_random_byte_count() {
  local byte_count="${1-}"
  [[ "$byte_count" =~ ^[0-9]+$ ]] || return 1
  ((byte_count > 0))
}

random_hex() {
  local byte_count="${1:-32}"
  _validate_random_byte_count "$byte_count" || return 1
  command -v openssl >/dev/null 2>&1 || {
    die '未找到 openssl'
    return 1
  }
  local value
  if ! value="$(openssl rand -hex "$byte_count")"; then
    return 1
  fi
  local expected_length=$((byte_count * 2))
  [[ ${#value} -eq "$expected_length" && "$value" =~ ^[0-9a-f]+$ ]] || return 1
  printf '%s\n' "$value"
}

random_base64url() {
  local byte_count="${1:-32}"
  _validate_random_byte_count "$byte_count" || return 1
  command -v openssl >/dev/null 2>&1 || {
    die '未找到 openssl'
    return 1
  }

  local value
  if ! value="$(openssl rand -base64 "$byte_count")"; then
    return 1
  fi
  value="${value//$'\n'/}"
  value="${value//$'\r'/}"
  value="${value//+/-}"
  value="${value//\//_}"
  value="${value//=}"
  local expected_length=$(((byte_count * 8 + 5) / 6))
  [[ ${#value} -eq "$expected_length" && "$value" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
  printf '%s\n' "$value"
}

collect_install_inputs() {
  RELAY_API_KEY=''
  ADMIN_EMAIL=''
  ADMIN_PASSWORD=''
  ADMIN_PASSWORD_CONFIRM=''

  printf '请输入系统 Relay API Key：'
  IFS= read -r RELAY_API_KEY || {
    die '未读取到系统 Relay API Key'
    return 1
  }
  [[ -n "$RELAY_API_KEY" && "$RELAY_API_KEY" != *$'\r'* ]] || {
    die '系统 Relay API Key 不能为空或包含回车'
    return 1
  }
  printf '\n系统 Relay API Key（完整）：%s\n' "$RELAY_API_KEY"
  if ! confirm_yes '确认以上 Key'; then
    printf '\n'
    die '已取消：系统 Relay API Key 未确认'
    return 1
  fi

  printf '\n请输入管理员邮箱：'
  IFS= read -r ADMIN_EMAIL || {
    die '未读取到管理员邮箱'
    return 1
  }
  ADMIN_EMAIL="$(canonicalize_email "$ADMIN_EMAIL")"
  validate_email "$ADMIN_EMAIL" || {
    die '管理员邮箱格式无效'
    return 1
  }

  printf '\n请输入管理员密码（输入内容会显示）：'
  IFS= read -r ADMIN_PASSWORD || {
    die '未读取到管理员密码'
    return 1
  }
  printf '\n请再次输入管理员密码（输入内容会显示）：'
  IFS= read -r ADMIN_PASSWORD_CONFIRM || {
    die '未读取到管理员密码确认'
    return 1
  }
  [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD_CONFIRM" ]] || {
    die '两次输入的管理员密码不一致'
    return 1
  }
  validate_password "$ADMIN_PASSWORD" || {
    die '管理员密码必须为 6-72 个 UTF-8 字节'
    return 1
  }

  printf '\n部署模式：%s\n' "${MODE_LABEL:-未指定}"
  printf '管理员邮箱：%s\n' "$ADMIN_EMAIL"
  if ! confirm_yes '确认开始部署'; then
    printf '\n'
    die '已取消部署'
    return 1
  fi
  printf '\n'
}

_write_deploy_env_line() {
  local key="$1"
  local value="$2"
  local quoted
  quoted="$(dotenv_quote "$value")" || return 1
  printf '%s=%s\n' "$key" "$quoted"
}

render_production_env() {
  local target_path="${1-}"
  [[ -n "$target_path" ]] || {
    die '未指定部署环境文件路径'
    return 1
  }

  local postgres_password="${POSTGRES_PASSWORD-}"
  local auth_secret="${BETTER_AUTH_SECRET-}"
  local relay_key="${RELAY_API_KEY-}"
  local encryption_key="${CUSTOM_KEY_JOB_ENCRYPTION_KEY-}"
  [[ -n "$postgres_password" ]] || {
    die '缺少 POSTGRES_PASSWORD'
    return 1
  }
  [[ -n "$auth_secret" ]] || {
    die '缺少 BETTER_AUTH_SECRET'
    return 1
  }
  [[ -n "$relay_key" ]] || {
    die '缺少 RELAY_API_KEY'
    return 1
  }
  [[ -n "$encryption_key" ]] || {
    die '缺少 CUSTOM_KEY_JOB_ENCRYPTION_KEY'
    return 1
  }

  local project_name="${COMPOSE_PROJECT_NAME:-ai-image-workshop}"
  local profiles="${COMPOSE_PROFILES-}"
  local image_tag="${IMAGE_TAG:-latest}"
  local domain="${DOMAIN-}"
  local bind_address="${WEB_BIND_ADDRESS:-127.0.0.1}"
  local host_port="${WEB_HOST_PORT:-18080}"
  local postgres_db="${POSTGRES_DB:-ai_image_workshop}"
  local postgres_user="${POSTGRES_USER:-ai_image_workshop}"
  local auth_url="${BETTER_AUTH_URL-}"
  local relay_base_url="${RELAY_BASE_URL:-https://api.tangguo.xin/v1}"

  if [[ ! "$host_port" =~ ^[0-9]+$ ]] || ((host_port < 1 || host_port > 65535)); then
    die 'WEB_HOST_PORT 无效'
    return 1
  fi
  [[ "$postgres_db" =~ ^[A-Za-z0-9_]+$ && "$postgres_user" =~ ^[A-Za-z0-9_]+$ ]] || {
    die 'PostgreSQL 数据库名或用户名无效'
    return 1
  }
  [[ "$postgres_password" =~ ^[A-Za-z0-9._~-]+$ ]] || {
    die 'POSTGRES_PASSWORD 必须是 URL 安全字符'
    return 1
  }
  [[ -n "$auth_url" ]] || {
    die '缺少 BETTER_AUTH_URL'
    return 1
  }

  local database_url="postgresql://${postgres_user}:${postgres_password}@postgres:5432/${postgres_db}"
  local target_dir='.'
  if [[ "$target_path" == */* ]]; then
    target_dir="${target_path%/*}"
    [[ -n "$target_dir" ]] || target_dir='/'
  fi
  [[ -d "$target_dir" ]] || {
    die "部署环境目录不存在：$target_dir"
    return 1
  }
  if [[ -e "$target_path" || -L "$target_path" ]]; then
    [[ -f "$target_path" && ! -L "$target_path" ]] || {
      die "部署环境目标必须是普通文件或不存在：$target_path"
      return 1
    }
  fi

  (
    umask 077
    local temp_path=''
    # shellcheck disable=SC2329 # Invoked by the signal and EXIT traps below.
    cleanup_rendered_env() {
      [[ -z "$temp_path" ]] || rm -f -- "$temp_path"
    }
    trap cleanup_rendered_env EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    temp_path="$(mktemp "${target_path}.tmp.XXXXXX")" || exit 1

    local -a entries=(
      COMPOSE_PROJECT_NAME "$project_name"
      COMPOSE_PROFILES "$profiles"
      IMAGE_TAG "$image_tag"
      DOMAIN "$domain"
      WEB_BIND_ADDRESS "$bind_address"
      WEB_HOST_PORT "$host_port"
      POSTGRES_DB "$postgres_db"
      POSTGRES_USER "$postgres_user"
      POSTGRES_PASSWORD "$postgres_password"
      DATABASE_DRIVER 'pg'
      DATABASE_URL "$database_url"
      DATABASE_URL_UNPOOLED "$database_url"
      STORAGE_DRIVER 'local'
      LOCAL_STORAGE_ROOT '/app/data/media'
      BETTER_AUTH_SECRET "$auth_secret"
      BETTER_AUTH_URL "$auth_url"
      RELAY_API_KEY "$relay_key"
      RELAY_BASE_URL "$relay_base_url"
      CUSTOM_KEY_JOB_ENCRYPTION_KEY "$encryption_key"
      CUSTOM_KEY_MODES_ENABLED 'false'
      WORKER_CONCURRENCY '1'
      TRUST_PROXY 'true'
    )
    local entry_index
    for ((entry_index = 0; entry_index < ${#entries[@]}; entry_index += 2)); do
      _write_deploy_env_line "${entries[entry_index]}" "${entries[entry_index + 1]}" || exit 1
    done >"$temp_path" || exit 1

    chmod 0600 "$temp_path" || exit 1
    mv -fT -- "$temp_path" "$target_path" || exit 1
    temp_path=''
    trap - EXIT HUP INT TERM
  )
}
