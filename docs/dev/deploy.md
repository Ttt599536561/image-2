# Debian Docker 一键部署

在项目根目录选择一种部署方式：

```bash
# Bundled Caddy owns 80/443
sudo bash deploy/install.sh --domain images.example.com

# Existing reverse proxy forwards to the printed 127.0.0.1 port
sudo bash deploy/install.sh --existing-proxy --public-url https://images.example.com

# Resume an interrupted install without rotating generated secrets
sudo bash deploy/install.sh --resume
```

## 前提

- 一台全新的 Debian 服务器，已安装 Docker Engine 与 Compose v2。
- 项目代码已位于服务器，命令从仓库根目录执行。
- 域名模式需要域名已解析到服务器，且宿主机 `80/443` 空闲。
- 现有代理模式不会启动 Caddy；安装器会选择空闲的 `127.0.0.1` 端口并输出上游地址。

首次安装从空数据开始，不迁移旧 Neon、Supabase 或 Netlify 数据。

## 安装时输入

终端只要求提供 3 个值：

1. 系统 Relay API Key，并确认一次。
2. 管理员邮箱。
3. 管理员密码，连续输入两次以校验一致。

Key 和密码使用普通可见输入。这样便于核对，但内容会留在终端滚动记录、录屏或远程操作日志中；请在可信终端操作。输入不会进入 shell 命令历史，管理员密码也不会写入长期配置。

确认后，脚本会自动完成预检、生成数据库与认证密钥、创建权限为 `600` 的 `deploy/.env.production`、启动 PostgreSQL、执行迁移、创建管理员、启动服务并检查 `/healthz`。不要手工填写示例环境文件。

管理员入口：`https://你的域名/admin/login`。

当前受支持的一键部署只开放 system 模式。custom Key 代码已实现，但安装器会保持 `CUSTOM_KEY_MODES_ENABLED=false`；在单独完成发布与回滚演练前不要手工修改该值。

## 端口与数据

- PostgreSQL 的 `5432` 仅在 Compose 私有网络内使用，不发布到宿主机。
- Web 的 `3000` 仅在容器内使用；宿主机已有 `3000` 服务不会冲突。
- 域名模式由 Caddy 对公网发布 `80/443`；Web 仍只绑定自动选择的回环端口。
- 现有代理模式只发布安装器选择的 `127.0.0.1:<端口>`。
- 数据库保存于 `postgres_data`，图片保存于 `media_data`；重建应用容器不会删除数据。

现有代理需要固定回环端口时可追加 `--port 18081`；端口已占用时安装器会停止，不会接管已有服务。

## 现有代理

安装器会打印类似 `http://127.0.0.1:18080` 的上游。Nginx 最小配置示例：

```nginx
location / {
  client_max_body_size 5m;
  proxy_pass http://127.0.0.1:18080;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

若打印的端口不是 `18080`，以实际输出为准。`X-Forwarded-For` 必须覆盖为直连客户端地址，不要使用会保留客户端伪造首段的 `$proxy_add_x_forwarded_for`。TLS、域名和公网入口由现有代理负责。

## 验证

```bash
docker compose --env-file deploy/.env.production ps
curl -fsS -o /dev/null -w '%{http_code}\n' https://images.example.com/healthz
```

预期健康检查返回 `204`，`postgres`、`web`、`worker`、`scheduler` 均正常；域名模式还应看到 `caddy`。随后用安装时设置的账号登录 `/admin/login`，完成一次 system 模式生图并确认 `/media/*` 图片可打开。

## 日常运维

```bash
sudo bash deploy/backup.sh
sudo bash deploy/install.sh --upgrade
sudo bash deploy/restore.sh deploy/backups/20260712T120000Z
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=100 web worker scheduler postgres
```

- 备份同时包含 PostgreSQL dump、媒体归档、校验和和版本清单，默认只保留最近 7 份完整本地备份。
- 升级会先备份，再构建镜像、迁移和重启；迁移开始后的失败必须按脚本提示恢复，不能直接反复升级。
- 恢复会校验三份归档文件和清单，只允许写入已停止且为空的目标卷，并要求输入 `RESTORE ai-image-workshop` 确认。
- 安装、备份、恢复和升级共用操作锁，同一时间只能运行一个。

`deploy/.env.production` 含系统 Key 和内部密钥，不得提交到 Git，也不在普通备份包中；请用权限 `600` 单独保管。多机高可用和自动异地备份不在当前单机部署范围内。

## 故障处理

- 安装中断：修复终端提示的问题后运行 `sudo bash deploy/install.sh --resume`。
- 查看日志：运行上面的 `logs` 命令；域名模式可额外加入 `caddy`。
- 不要删除 `postgres_data` 或 `media_data` 来处理启动失败。
- 不要直接执行不带 `--env-file deploy/.env.production` 的业务 Compose 命令。
