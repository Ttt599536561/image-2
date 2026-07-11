#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
ENV_PATH="$DEPLOY_DIR/.env.production"
ENV_ARGUMENT='deploy/.env.production'
STATE_PATH="$DEPLOY_DIR/install.state"

# shellcheck source=deploy/install-lib.sh
source "$DEPLOY_DIR/install-lib.sh"
cd "$PROJECT_ROOT"

MODE=''
MODE_LABEL=''
DOMAIN=''
PUBLIC_URL=''
WEB_HOST_PORT=''
WEB_BIND_ADDRESS='127.0.0.1'
COMPOSE_PROFILES=''
RESUME=false

STATE_STAGE='none'
STATE_VERSION='1'
ADMIN_EMAIL=''
ADMIN_PASSWORD=''
ADMIN_PASSWORD_CONFIRM=''
RELAY_API_KEY=''
POSTGRES_PASSWORD=''
BETTER_AUTH_SECRET=''
CUSTOM_KEY_JOB_ENCRYPTION_KEY=''

DIAGNOSTICS_ENABLED=false
DIAGNOSTIC_SERVICES=(web)

usage() {
  printf '%s\n' \
    '用法：' \
    '  sudo bash deploy/install.sh --domain images.example.com' \
    '  sudo bash deploy/install.sh --existing-proxy --public-url https://images.example.com [--port 18081]' \
    '  sudo bash deploy/install.sh --resume'
}

cleanup_secrets() {
  unset RELAY_API_KEY ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
  unset SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  unset POSTGRES_PASSWORD BETTER_AUTH_SECRET CUSTOM_KEY_JOB_ENCRYPTION_KEY
}

redact_text() {
  local value="${1-}"
  local secret prefix suffix
  local -a secrets=(
    "${RELAY_API_KEY-}"
    "${ADMIN_PASSWORD-}"
    "${ADMIN_PASSWORD_CONFIRM-}"
    "${SEED_ADMIN_PASSWORD-}"
    "${POSTGRES_PASSWORD-}"
    "${BETTER_AUTH_SECRET-}"
    "${CUSTOM_KEY_JOB_ENCRYPTION_KEY-}"
  )

  for secret in "${secrets[@]}"; do
    [[ -n "$secret" ]] || continue
    while [[ "$value" == *"$secret"* ]]; do
      prefix="${value%%"$secret"*}"
      suffix="${value#*"$secret"}"
      value="${prefix}[REDACTED]${suffix}"
    done
  done
  printf '%s\n' "$value"
}

compose() {
  if [[ ! -f "$ENV_PATH" || -L "$ENV_PATH" ]]; then
    die "部署环境文件不是安全的普通文件：$ENV_PATH"
    return 1
  fi
  docker compose --env-file "$ENV_ARGUMENT" "$@"
}

print_failure_diagnostics() {
  local output=''
  printf '\n部署未完成。以下诊断信息已隐藏敏感值：\n' >&2
  if output="$(compose ps 2>&1)"; then
    redact_text "$output" >&2
  else
    redact_text "$output" >&2
  fi
  if output="$(compose logs --tail 100 "${DIAGNOSTIC_SERVICES[@]}" 2>&1)"; then
    redact_text "$output" >&2
  else
    redact_text "$output" >&2
  fi
  printf '%s\n' '修复问题后继续执行：sudo bash deploy/install.sh --resume' >&2
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if ((status != 0)) && [[ "$DIAGNOSTICS_ENABLED" == true ]]; then
    print_failure_diagnostics
  fi
  cleanup_secrets
  exit "$status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

parse_args() {
  local domain_seen=false
  local proxy_seen=false
  local public_url_seen=false
  local port_seen=false
  local resume_seen=false

  (($# > 0)) || {
    die '必须选择一种部署模式'
    return 2
  }

  while (($# > 0)); do
    case "$1" in
      --domain)
        [[ "$domain_seen" == false ]] || {
          die '--domain 不能重复'
          return 2
        }
        (($# >= 2)) && [[ "$2" != --* ]] || {
          die '--domain 缺少域名'
          return 2
        }
        domain_seen=true
        DOMAIN="$2"
        shift 2
        ;;
      --existing-proxy)
        [[ "$proxy_seen" == false ]] || {
          die '--existing-proxy 不能重复'
          return 2
        }
        proxy_seen=true
        shift
        ;;
      --public-url)
        [[ "$public_url_seen" == false ]] || {
          die '--public-url 不能重复'
          return 2
        }
        (($# >= 2)) && [[ "$2" != --* ]] || {
          die '--public-url 缺少 URL'
          return 2
        }
        public_url_seen=true
        PUBLIC_URL="$2"
        shift 2
        ;;
      --port)
        [[ "$port_seen" == false ]] || {
          die '--port 不能重复'
          return 2
        }
        (($# >= 2)) && [[ "$2" != --* ]] || {
          die '--port 缺少端口号'
          return 2
        }
        port_seen=true
        WEB_HOST_PORT="$2"
        shift 2
        ;;
      --resume)
        [[ "$resume_seen" == false ]] || {
          die '--resume 不能重复'
          return 2
        }
        resume_seen=true
        RESUME=true
        shift
        ;;
      *)
        die "未知参数：$1"
        return 2
        ;;
    esac
  done

  if [[ "$RESUME" == true ]]; then
    if [[ "$domain_seen" == true || "$proxy_seen" == true || "$public_url_seen" == true || "$port_seen" == true ]]; then
      die '--resume 不能与其他部署参数一起使用'
      return 2
    fi
    MODE='resume'
    return 0
  fi

  if [[ "$domain_seen" == true && "$proxy_seen" == true ]]; then
    die '--domain 与 --existing-proxy 不能同时使用'
    return 2
  fi
  if [[ "$domain_seen" == true ]]; then
    if [[ "$public_url_seen" == true || "$port_seen" == true ]]; then
      die '域名模式不接受 --public-url 或 --port'
      return 2
    fi
    MODE='domain'
    return 0
  fi
  if [[ "$proxy_seen" == true ]]; then
    [[ "$public_url_seen" == true ]] || {
      die '现有反向代理模式必须提供 --public-url'
      return 2
    }
    MODE='proxy'
    return 0
  fi

  die '必须选择 --domain、--existing-proxy 或 --resume'
  return 2
}

validate_domain_name() {
  local domain="${1-}"
  local remainder label
  local byte_count
  byte_count="$(LC_ALL=C printf '%s' "$domain" | wc -c)"
  ((byte_count >= 4 && byte_count <= 253)) || return 1
  [[ "$domain" == *.* ]] || return 1
  [[ "$domain" != .* && "$domain" != *. && "$domain" != *..* ]] || return 1
  [[ "$domain" != *[!A-Za-z0-9.-]* ]] || return 1
  [[ ! "$domain" =~ ^[0-9.]+$ ]] || return 1

  remainder="$domain"
  while [[ "$remainder" == *.* ]]; do
    label="${remainder%%.*}"
    remainder="${remainder#*.}"
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1
  done
  label="$remainder"
  [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]]
}

valid_port_number() {
  local port="${1-}"
  [[ "$port" =~ ^[0-9]+$ ]] || return 1
  ((port >= 1 && port <= 65535))
}

validate_public_url() {
  local url="${1-}"
  local scheme host port=''

  if [[ "$url" =~ ^(https)://([^/:?#]+)(:([0-9]+))?$ ]]; then
    scheme="${BASH_REMATCH[1]}"
    host="${BASH_REMATCH[2]}"
    port="${BASH_REMATCH[4]-}"
  elif [[ "${INSTALL_ALLOW_HTTP_LOOPBACK:-0}" == '1' && "$url" =~ ^(http)://(localhost|127\.0\.0\.1)(:([0-9]+))?$ ]]; then
    scheme="${BASH_REMATCH[1]}"
    host="${BASH_REMATCH[2]}"
    port="${BASH_REMATCH[4]-}"
  else
    return 1
  fi

  [[ "$scheme" == 'https' || "$host" == 'localhost' || "$host" == '127.0.0.1' ]] || return 1
  if [[ "$host" != 'localhost' && "$host" != '127.0.0.1' ]]; then
    validate_domain_name "$host" || return 1
  fi
  [[ -z "$port" ]] || valid_port_number "$port"
}

require_free_port() {
  local port="$1"
  local purpose="$2"
  local status=0
  if port_is_free "$port"; then
    return 0
  else
    status=$?
  fi
  if ((status == 2)); then
    die "无法检查${purpose}端口 $port"
  else
    die "${purpose}端口 $port 已被占用；安装器不会停止或修改现有服务"
  fi
}

preflight_common() {
  if [[ "${INSTALL_ALLOW_NON_ROOT:-0}" != '1' ]] && ((EUID != 0)); then
    die '请使用 sudo 以 root 身份运行安装器'
    return 1
  fi

  local os_release_file="${INSTALL_OS_RELEASE_FILE:-/etc/os-release}"
  [[ -f "$os_release_file" && ! -L "$os_release_file" ]] || {
    die "无法读取系统信息：$os_release_file"
    return 1
  }
  local os_id
  os_id="$(awk -F= '$1 == "ID" { value=$2; gsub(/^\"|\"$/, "", value); print value; exit }' "$os_release_file")"
  [[ "$os_id" == 'debian' ]] || {
    die "仅支持 Debian，当前系统 ID：${os_id:-未知}"
    return 1
  }

  local required_command
  for required_command in docker openssl ss curl df awk stat mktemp; do
    command -v "$required_command" >/dev/null 2>&1 || {
      die "未找到必需命令：$required_command"
      return 1
    }
  done

  local required_path
  for required_path in \
    "$PROJECT_ROOT/compose.yaml" \
    "$DEPLOY_DIR/Caddyfile" \
    "$DEPLOY_DIR/install-lib.sh" \
    "$PROJECT_ROOT/scripts/seed-admin.ts"; do
    [[ -f "$required_path" && ! -L "$required_path" ]] || {
      die "项目文件缺失或不安全：$required_path"
      return 1
    }
  done

  docker info >/dev/null 2>&1 || {
    die 'Docker 守护进程不可用'
    return 1
  }
  docker compose version >/dev/null 2>&1 || {
    die 'Docker Compose v2 不可用'
    return 1
  }

  local minimum_free_kib="${INSTALL_MIN_FREE_KIB:-10485760}"
  if [[ ! "$minimum_free_kib" =~ ^[0-9]+$ ]] || ! ((minimum_free_kib > 0)); then
    die '磁盘空间阈值配置无效'
    return 1
  fi
  local available_kib
  available_kib="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
  [[ "$available_kib" =~ ^[0-9]+$ ]] || {
    die '无法读取可用磁盘空间'
    return 1
  }
  ((available_kib >= minimum_free_kib)) || {
    die '可用磁盘空间不足，至少需要 10 GiB'
    return 1
  }
}

prepare_fresh_mode() {
  case "$MODE" in
    domain)
      validate_domain_name "$DOMAIN" || {
        die '域名必须是不含协议、端口或路径的有效 DNS 名称'
        return 1
      }
      PUBLIC_URL="https://$DOMAIN"
      COMPOSE_PROFILES='caddy'
      MODE_LABEL="内置 Caddy（$DOMAIN）"
      require_free_port 80 'HTTP ' || return 1
      require_free_port 443 'HTTPS ' || return 1
      WEB_HOST_PORT="$(find_free_port)" || return 1
      ;;
    proxy)
      validate_public_url "$PUBLIC_URL" || {
        die '现有反向代理的公开 URL 必须是无路径的 HTTPS URL'
        return 1
      }
      COMPOSE_PROFILES=''
      DOMAIN=''
      MODE_LABEL="现有反向代理（$PUBLIC_URL）"
      if [[ -n "$WEB_HOST_PORT" ]]; then
        valid_port_number "$WEB_HOST_PORT" || {
          die '--port 必须是 1-65535 之间的端口号'
          return 1
        }
        require_free_port "$WEB_HOST_PORT" 'Web ' || return 1
      else
        WEB_HOST_PORT="$(find_free_port)" || return 1
      fi
      ;;
    *)
      die '内部错误：未确定部署模式'
      return 1
      ;;
  esac
}

fresh_state_guard() {
  local existing_path
  for existing_path in "$ENV_PATH" "$STATE_PATH"; do
    if [[ -e "$existing_path" || -L "$existing_path" ]]; then
      die "检测到已有部署状态：$existing_path。若要继续，请运行 sudo bash deploy/install.sh --resume"
      return 1
    fi
  done

  local volume_name
  for volume_name in ai-image-workshop_postgres_data ai-image-workshop_media_data; do
    if docker volume inspect "$volume_name" >/dev/null 2>&1; then
      die "检测到已有 Docker 卷：$volume_name。若要继续，请运行 sudo bash deploy/install.sh --resume"
      return 1
    fi
  done
}

set_fresh_environment_defaults() {
  COMPOSE_PROJECT_NAME='ai-image-workshop'
  IMAGE_TAG='latest'
  POSTGRES_DB='ai_image_workshop'
  POSTGRES_USER='ai_image_workshop'
  BETTER_AUTH_URL="$PUBLIC_URL"
  RELAY_BASE_URL='https://api.tangguo.xin/v1'
  POSTGRES_PASSWORD="$(random_hex 32)"
  BETTER_AUTH_SECRET="$(random_base64url 32)"
  CUSTOM_KEY_JOB_ENCRYPTION_KEY="$(random_base64url 32)"
}

private_file_is_safe() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || return 1
  local mode
  mode="$(stat -c '%a' "$path")" || return 1
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (((0$mode & 077) == 0))
}

clear_loaded_deploy_variables() {
  unset COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT
  unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED
  unset STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL
  unset CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY
}

unexport_sensitive_variables() {
  export -n RELAY_API_KEY POSTGRES_PASSWORD BETTER_AUTH_SECRET CUSTOM_KEY_JOB_ENCRYPTION_KEY 2>/dev/null || true
}

validate_loaded_environment() {
  local required_key
  for required_key in \
    COMPOSE_PROJECT_NAME COMPOSE_PROFILES IMAGE_TAG DOMAIN WEB_BIND_ADDRESS WEB_HOST_PORT \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_DRIVER DATABASE_URL DATABASE_URL_UNPOOLED \
    STORAGE_DRIVER LOCAL_STORAGE_ROOT BETTER_AUTH_SECRET BETTER_AUTH_URL RELAY_API_KEY RELAY_BASE_URL \
    CUSTOM_KEY_JOB_ENCRYPTION_KEY CUSTOM_KEY_MODES_ENABLED WORKER_CONCURRENCY TRUST_PROXY; do
    [[ -v "$required_key" ]] || {
      die "部署环境文件缺少键：$required_key"
      return 1
    }
  done

  [[ "$COMPOSE_PROJECT_NAME" == 'ai-image-workshop' ]] || {
    die 'COMPOSE_PROJECT_NAME 必须是 ai-image-workshop'
    return 1
  }
  [[ "$IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || {
    die 'IMAGE_TAG 无效'
    return 1
  }
  [[ "$WEB_BIND_ADDRESS" == '127.0.0.1' ]] || {
    die 'WEB_BIND_ADDRESS 必须是 127.0.0.1'
    return 1
  }
  valid_port_number "$WEB_HOST_PORT" || {
    die 'WEB_HOST_PORT 无效'
    return 1
  }
  [[ "$POSTGRES_DB" =~ ^[A-Za-z0-9_]+$ && "$POSTGRES_USER" =~ ^[A-Za-z0-9_]+$ ]] || {
    die 'PostgreSQL 数据库名或用户名无效'
    return 1
  }
  [[ -n "$POSTGRES_PASSWORD" && "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]] || {
    die 'POSTGRES_PASSWORD 无效'
    return 1
  }
  local expected_database_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  # shellcheck disable=SC2153 # These keys are populated by the safe dotenv loader above.
  [[ "$DATABASE_DRIVER" == 'pg' && "$DATABASE_URL" == "$expected_database_url" && "$DATABASE_URL_UNPOOLED" == "$expected_database_url" ]] || {
    die 'PostgreSQL 连接配置无效'
    return 1
  }
  [[ "$STORAGE_DRIVER" == 'local' && "$LOCAL_STORAGE_ROOT" == '/app/data/media' ]] || {
    die '本地存储配置无效'
    return 1
  }
  [[ -n "$BETTER_AUTH_SECRET" && -n "$RELAY_API_KEY" && -n "$CUSTOM_KEY_JOB_ENCRYPTION_KEY" ]] || {
    die '部署环境文件包含空的必需密钥'
    return 1
  }
  [[ "$CUSTOM_KEY_MODES_ENABLED" == 'false' && "$TRUST_PROXY" == 'true' ]] || {
    die '应用安全配置无效'
    return 1
  }
  [[ "$WORKER_CONCURRENCY" =~ ^[1-9][0-9]*$ ]] || {
    die 'WORKER_CONCURRENCY 无效'
    return 1
  }

  if [[ "$COMPOSE_PROFILES" == 'caddy' ]]; then
    validate_domain_name "$DOMAIN" || {
      die '部署环境中的 DOMAIN 无效'
      return 1
    }
    [[ "$BETTER_AUTH_URL" == "https://$DOMAIN" ]] || {
      die '部署环境中的公开 URL 与 DOMAIN 不一致'
      return 1
    }
    MODE='domain'
    PUBLIC_URL="$BETTER_AUTH_URL"
    MODE_LABEL="内置 Caddy（$DOMAIN）"
  elif [[ -z "$COMPOSE_PROFILES" && -z "$DOMAIN" ]]; then
    validate_public_url "$BETTER_AUTH_URL" || {
      die '部署环境中的公开 URL 无效'
      return 1
    }
    MODE='proxy'
    PUBLIC_URL="$BETTER_AUTH_URL"
    MODE_LABEL="现有反向代理（$PUBLIC_URL）"
  else
    die '部署环境中的模式配置无效'
    return 1
  fi
}

stage_index() {
  case "${1-}" in
    none) printf '0\n' ;;
    configured) printf '1\n' ;;
    postgres_ready) printf '2\n' ;;
    migrated) printf '3\n' ;;
    admin_seeded) printf '4\n' ;;
    services_started) printf '5\n' ;;
    complete) printf '6\n' ;;
    *) return 1 ;;
  esac
}

stage_at_least() {
  local current target
  current="$(stage_index "$STATE_STAGE")" || return 1
  target="$(stage_index "$1")" || return 1
  ((current >= target))
}

write_install_state() {
  local stage="$1"
  stage_index "$stage" >/dev/null || {
    die "拒绝写入未知安装状态：$stage"
    return 1
  }
  if [[ -e "$STATE_PATH" || -L "$STATE_PATH" ]]; then
    [[ -f "$STATE_PATH" && ! -L "$STATE_PATH" ]] || {
      die "安装状态目标不是安全的普通文件：$STATE_PATH"
      return 1
    }
  fi

  (
    umask 077
    local temp_path=''
    # shellcheck disable=SC2329 # Invoked by the EXIT trap below.
    cleanup_state_temp() {
      [[ -z "$temp_path" ]] || rm -f -- "$temp_path"
    }
    trap cleanup_state_temp EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    temp_path="$(mktemp "${STATE_PATH}.tmp.XXXXXX")"
    {
      _write_deploy_env_line STATE_VERSION "$STATE_VERSION"
      _write_deploy_env_line STAGE "$stage"
      if [[ -n "$ADMIN_EMAIL" ]]; then
        _write_deploy_env_line ADMIN_EMAIL "$ADMIN_EMAIL"
      fi
    } >"$temp_path"
    chmod 0600 "$temp_path"
    mv -fT -- "$temp_path" "$STATE_PATH"
    temp_path=''
    trap - EXIT HUP INT TERM
  )
  STATE_STAGE="$stage"
}

load_install_state() {
  if [[ ! -e "$STATE_PATH" && ! -L "$STATE_PATH" ]]; then
    STATE_STAGE='none'
    ADMIN_EMAIL=''
    return 0
  fi
  private_file_is_safe "$STATE_PATH" || {
    die "安装状态文件不是权限安全的普通文件：$STATE_PATH"
    return 1
  }

  local line='' key encoded decoded
  local line_number=0
  local parsed_version=''
  local parsed_stage=''
  local parsed_email=''
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    [[ -n "$line" && "$line" != \#* && "$line" == *=* ]] || {
      die "安装状态文件第 $line_number 行无效"
      return 1
    }
    key="${line%%=*}"
    encoded="${line#*=}"
    case "$key" in
      STATE_VERSION | STAGE | ADMIN_EMAIL) ;;
      *)
        die "安装状态文件包含未知键：$key"
        return 1
        ;;
    esac
    [[ ! ${seen[$key]+present} ]] || {
      die "安装状态文件包含重复键：$key"
      return 1
    }
    decoded="$(dotenv_unquote "$encoded")" || {
      die "安装状态文件第 $line_number 行值无效"
      return 1
    }
    seen["$key"]=1
    case "$key" in
      STATE_VERSION) parsed_version="$decoded" ;;
      STAGE) parsed_stage="$decoded" ;;
      ADMIN_EMAIL) parsed_email="$decoded" ;;
    esac
  done <"$STATE_PATH"

  [[ "$parsed_version" == '1' ]] || {
    die '安装状态版本无效'
    return 1
  }
  stage_index "$parsed_stage" >/dev/null || {
    die "安装状态值无效：$parsed_stage"
    return 1
  }
  if [[ -n "$parsed_email" ]]; then
    validate_email "$parsed_email" || {
      die '安装状态中的管理员邮箱无效'
      return 1
    }
  fi
  if [[ "$(stage_index "$parsed_stage")" -ge "$(stage_index admin_seeded)" && -z "$parsed_email" ]]; then
    die '已创建管理员的安装状态缺少管理员邮箱'
    return 1
  fi

  STATE_STAGE="$parsed_stage"
  ADMIN_EMAIL="$parsed_email"
}

prepare_resume() {
  private_file_is_safe "$ENV_PATH" || {
    die "续装要求权限安全的普通环境文件：$ENV_PATH"
    return 1
  }
  clear_loaded_deploy_variables
  load_deploy_env "$ENV_PATH" || return 1
  validate_loaded_environment || return 1
  unexport_sensitive_variables
  load_install_state
}

collect_resume_admin_inputs() {
  ADMIN_EMAIL=''
  ADMIN_PASSWORD=''
  ADMIN_PASSWORD_CONFIRM=''

  printf '请输入管理员邮箱：'
  IFS= read -r ADMIN_EMAIL || {
    die '未读取到管理员邮箱'
    return 1
  }
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
  printf '\n'
}

wait_for_postgres() {
  local attempt
  for ((attempt = 1; attempt <= 120; attempt += 1)); do
    if compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die 'PostgreSQL 在 120 秒内未就绪'
}

verify_admin_roles() {
  [[ -n "$ADMIN_EMAIL" ]] || {
    die '缺少待验证的管理员邮箱'
    return 1
  }
  local query
  query=$'SELECT COALESCE((SELECT role FROM users WHERE email = :\'admin_email\'), \'\');\nSELECT COALESCE((SELECT role FROM "user" WHERE email = :\'admin_email\'), \'\');'
  local role_output
  role_output="$(compose exec -T postgres psql \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    -v "admin_email=$ADMIN_EMAIL" \
    -Atc "$query")" || {
    die '无法验证管理员角色'
    return 1
  }
  local -a roles=()
  mapfile -t roles <<<"$role_output"
  [[ ${#roles[@]} -eq 2 && "${roles[0]}" == 'admin' && "${roles[1]}" == 'admin' ]] || {
    die '管理员角色验证失败：业务用户表和认证用户表必须同时为 admin'
    return 1
  }
}

seed_admin() {
  local seed_status=0
  local seed_output=''
  if seed_output="$(
    SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
      compose run --rm \
        -e SEED_ADMIN_EMAIL \
        -e SEED_ADMIN_PASSWORD \
        web node --import tsx scripts/seed-admin.ts 2>&1
  )"; then
    seed_status=0
  else
    seed_status=$?
  fi

  unset SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  [[ -z "$seed_output" ]] || redact_text "$seed_output"
  if ((seed_status != 0)); then
    return "$seed_status"
  fi
  unset ADMIN_PASSWORD ADMIN_PASSWORD_CONFIRM
  write_install_state admin_seeded
}

start_application_services() {
  compose up -d web worker scheduler
  if [[ "$MODE" == 'domain' ]]; then
    compose --profile caddy up -d caddy
  fi
}

wait_for_web_health() {
  local attempt http_code
  for ((attempt = 1; attempt <= 180; attempt += 1)); do
    http_code=''
    if http_code="$(curl \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      "http://127.0.0.1:${WEB_HOST_PORT}/healthz" 2>/dev/null)" \
      && [[ "$http_code" == '204' ]]; then
      return 0
    fi
    sleep 1
  done
  die 'Web 健康检查在 180 秒内未返回 HTTP 204'
}

run_deployment_stages() {
  DIAGNOSTICS_ENABLED=true
  DIAGNOSTIC_SERVICES=(web)
  compose config --quiet
  if ! stage_at_least configured; then
    write_install_state configured
  fi

  DIAGNOSTIC_SERVICES=(postgres)
  compose up -d postgres
  wait_for_postgres
  if ! stage_at_least postgres_ready; then
    write_install_state postgres_ready
  fi

  if ! stage_at_least migrated; then
    DIAGNOSTIC_SERVICES=(web)
    compose build web
    compose run --rm \
      -e MIGRATE_CONFIRM=APPLY_PRODUCTION_MIGRATIONS \
      web npm run db:migrate:production
    write_install_state migrated
  fi

  if ! stage_at_least admin_seeded; then
    if [[ "$RESUME" == true ]]; then
      collect_resume_admin_inputs
    fi
    DIAGNOSTIC_SERVICES=(web)
    seed_admin
  fi

  DIAGNOSTIC_SERVICES=(postgres)
  verify_admin_roles

  DIAGNOSTIC_SERVICES=(web worker scheduler)
  [[ "$MODE" != 'domain' ]] || DIAGNOSTIC_SERVICES+=(caddy)
  start_application_services
  if ! stage_at_least services_started; then
    write_install_state services_started
  fi

  DIAGNOSTIC_SERVICES=(web)
  wait_for_web_health
  if ! stage_at_least complete; then
    write_install_state complete
  fi
}

print_success() {
  printf '%s\n' \
    '' \
    '部署完成。' \
    "访问地址：$PUBLIC_URL" \
    "管理员登录：$PUBLIC_URL/admin/login"
  if [[ "$MODE" == 'proxy' ]]; then
    printf '反向代理上游地址：http://127.0.0.1:%s\n' "$WEB_HOST_PORT"
  fi
}

main() {
  local parse_status=0
  if parse_args "$@"; then
    :
  else
    parse_status=$?
    usage >&2
    return "$parse_status"
  fi

  if [[ "$MODE" == 'resume' ]]; then
    preflight_common
    prepare_resume
  else
    prepare_fresh_mode
    preflight_common
    fresh_state_guard
    collect_install_inputs
    set_fresh_environment_defaults
    render_production_env "$ENV_PATH"
    clear_loaded_deploy_variables
    load_deploy_env "$ENV_PATH"
    validate_loaded_environment
    unexport_sensitive_variables
    STATE_STAGE='none'
  fi

  run_deployment_stages
  print_success
}

main "$@"
