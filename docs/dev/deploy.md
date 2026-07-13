# Docker 部署与运维

要求 Debian、Docker Engine、Docker Compose v2、Git、jq 和 systemd。所有命令都从项目根目录执行；首次安装从空 PostgreSQL 和空媒体卷开始，不迁移 Neon、Supabase 或 Netlify 数据。

当前生产基线：腾讯云站点 `https://one-image2.tangguo.xin` 于 2026-07-13 升级到 `0.2.0`，提交为 `c5131aaa0335250a3846c380519324fbbf4b231b`。生产证据统一见 [PROGRESS.md](../PROGRESS.md)。

## 安装

```bash
git clone https://github.com/Ttt599536561/image-2.git ai-image-workshop
cd ai-image-workshop

# 方式 A：Caddy 自动配置 HTTPS；域名需已解析，80/443 需空闲
sudo bash deploy/install.sh --domain images.example.com

# 方式 B：使用已有反向代理
sudo bash deploy/install.sh \
  --existing-proxy \
  --public-url https://images.example.com
```

安装器依次询问系统 Relay API Key、管理员邮箱和管理员密码，其余数据库、认证和 custom Key 加密密钥自动生成。Key 和密码会显示在终端中，请只在可信终端操作并注意滚动记录、录屏和远程操作日志。管理员入口是 `https://images.example.com/admin/login`。

新部署默认同时开放两种模式：

- `system`：使用站长 Relay Key，成功落图后扣本站积分。
- `custom`：使用用户自己的 Key，不检查或扣除本站积分。

已有代理应转发到脚本最后打印的 `http://127.0.0.1:<端口>`。固定端口可在安装命令中追加 `--port 18080`。

Nginx 最小示例：

```nginx
location / {
  client_max_body_size 5m;
  proxy_pass http://127.0.0.1:18080;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

`X-Forwarded-For` 必须覆盖为直连客户端地址。应用在 `TRUST_PROXY=true` 时使用首个转发地址做 IP 限流，因此不要改用会保留客户端伪造首段的 `$proxy_add_x_forwarded_for`。

## 验证

```bash
docker compose --env-file deploy/.env.production ps
curl -fsS -o /dev/null -w '%{http_code}\n' https://images.example.com/healthz
```

健康检查应返回 `204`。`postgres` 和 `web` 应为 healthy，`worker`、`scheduler` 应处于运行状态；Caddy 模式还应看到 `caddy`。

安装成功后还会创建 `ai-image-workshop-updater` 系统组、初始化 `/var/lib/ai-image-workshop-updater`，并启用 `ai-image-workshop-update.service` 与 `.path`。旧部署执行一次 `sudo bash deploy/install.sh --upgrade` 后会自动补齐这套初始化；不需要给 Web Docker socket。

当前生产实例已经完成这次引导：`.path` 为 enabled/active，service 为 enabled，更新器状态为 idle。

随后依次检查：

1. 使用安装时的邮箱登录 `/admin/login`。
2. 完成一次 `system` 生成并确认成功后只扣一次积分。
3. 使用普通用户选择 `custom`、填写自己的 Key，确认能够生成且本站余额不变。
4. 打开生成结果的 `/media/*` 地址。
5. 打开 `/favicon.svg?v=1`；浏览器仍缓存旧标签图标时，关闭标签页后重新打开。

## 更新与运维

管理员可在 `/admin/system-update` 点击“检查更新”。更新通道固定为公开仓库 `Ttt599536561/image-2` 的最新稳定 GitHub Release；draft、prerelease、非严格 `vMAJOR.MINOR.PATCH` 和非递增版本都会被拒绝。点击“立即更新”后，网站会进入数分钟维护窗口：先排空任务、停止写入服务、校验备份，再拉取精确 tag、构建、迁移和健康检查。

更新器功能已经部署，但 GitHub `main`、`v0.2.0` tag 与 stable/latest Release 尚未发布。先完成 `0.2.0` 基线发布；后台首次正式一键更新应使用之后严格递增的稳定版，不能把当前部署分支伪装成 Release。

页面重连期间可在服务器查看同一请求：

```bash
sudo /usr/local/sbin/ai-image-workshop-update status <REQUEST_ID>
```

迁移前失败会自动恢复旧提交、旧镜像和原服务。迁移开始后的失败不会自动重复迁移，页面与 `status` 会给出唯一恢复命令：

```bash
sudo /usr/local/sbin/ai-image-workshop-update recover <REQUEST_ID>
# 按提示输入：RECOVER ai-image-workshop
```

该恢复只把已校验备份中的数据库恢复到旧版本，不覆盖媒体，也不运行迁移。恢复成功前不要删除 `deploy/backups/<BACKUP_ID>/.system-update-pin`、更新器状态或 rollback 镜像。

```bash
# 更新代码并升级；升级会先备份，再构建、迁移和重启
git pull --ff-only
sudo bash deploy/install.sh --upgrade

# 中断安装后继续；不会轮换已经生成的密钥
sudo bash deploy/install.sh --resume

# 状态与日志
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=100 -f web worker scheduler postgres

# 备份与恢复
sudo bash deploy/backup.sh
sudo bash deploy/restore.sh deploy/backups/<BACKUP_ID>
```

升级开始迁移后的失败必须按脚本提示恢复，不要直接反复执行 `--upgrade`。恢复只允许写入已停止且为空的目标卷，并要求输入确认串。

发布新版时，先把 `package.json` 与 `package-lock.json` 改为同一稳定版本并合入 `main`，再由维护者创建并推送匹配的 `vX.Y.Z` tag。CI 会验证版本单调递增、tag 指向 `main` 中的精确提交，再发布 stable/latest GitHub Release。不要修改或复用已经发布的 tag；建议在 GitHub ruleset 中禁止 tag 更新和删除。

## 已知故障

### 无法读取 `/etc/os-release`

从提交 `c5131aa` 起，安装器原生支持 Debian 标准的 `/etc/os-release -> /usr/lib/os-release` 符号链接，不需要环境变量绕过。若仍出现该错误，检查链接是否断裂、目标是否为可读普通文件，以及系统 `ID` 是否确为 `debian`；不要用其他发行版文件伪装 Debian。

### 已创建管理员的状态缺少管理员邮箱

此错误表示 `deploy/install.state` 已记录管理员创建完成，但缺少对应邮箱。不要删除状态文件或数据卷。先确认已有管理员的真实邮箱，再修复状态并续装：

```bash
sudo cp --preserve=mode,ownership deploy/install.state /root/ai-image-workshop-install.state.bak
sudo sed -i '/^ADMIN_EMAIL=/d' deploy/install.state
printf 'ADMIN_EMAIL="%s"\n' 'admin@example.com' | sudo tee -a deploy/install.state >/dev/null
sudo chmod 600 deploy/install.state
sudo bash deploy/install.sh --resume
```

必须把示例邮箱替换为已经创建的管理员邮箱。若无法确认邮箱，应先从数据库或备份核实，不要猜测。

### custom 无法提交请求

使用运行中的 Web 容器按应用相同规则检查开关和密钥格式，命令只输出 `<valid>` 或 `<invalid>`，不会打印密钥：

```bash
docker compose --env-file deploy/.env.production exec -T web node -e '
  const key = process.env.CUSTOM_KEY_JOB_ENCRYPTION_KEY ?? "";
  let valid = false;
  for (const encoding of ["base64", "base64url"]) {
    const decoded = Buffer.from(key, encoding);
    if (decoded.length === 32 && decoded.toString(encoding) === key) valid = true;
  }
  console.log(`CUSTOM_KEY_MODES_ENABLED=${process.env.CUSTOM_KEY_MODES_ENABLED}`);
  console.log(`CUSTOM_KEY_JOB_ENCRYPTION_KEY=${valid ? "<valid>" : "<invalid>"}`);
'
```

`CUSTOM_KEY_MODES_ENABLED` 应为 `"true"`，并且必须存在 `CUSTOM_KEY_JOB_ENCRYPTION_KEY`。该密钥必须严格解码为 32 字节，可使用 canonical base64 或无填充 base64url；后者通常为 43 个字符。不要在仍有 custom 任务运行时轮换或删除该密钥；缺失时应从原生产配置恢复。修改旧部署的开关或密钥后，需要重建 `web`、`worker`、`scheduler` 才会生效。

## 数据与秘密

- PostgreSQL 保存于 `postgres_data`，图片保存于 `media_data`；重建应用容器不会删除数据。
- PostgreSQL 的 `5432` 不发布到宿主机，Web 只绑定安装器选择的回环端口。
- `deploy/.env.production` 含 Relay Key 和内部密钥，权限应为 `600`，不得提交到 Git。
- 业务 Compose 命令必须显式带 `--env-file deploy/.env.production`。
- Web 只挂载控制目录的 `inbox`（读写）和 `state`（只读）；worker/scheduler 均不挂载，任何应用容器都不挂载 Docker socket 或项目根目录。
- 不要删除数据卷、安装状态或生产环境文件来处理普通启动故障。
