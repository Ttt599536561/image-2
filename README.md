# AI 图像工坊

<p align="center">
  <img src="public/favicon.svg" width="96" height="96" alt="AI 图像工坊图标" />
</p>

AI 图像工坊是一个需要登录的对话式 AI 生图应用，固定使用 `gpt-image-2`，支持站点统一中转和用户自带 Key 两种生成方式。

已部署站点：[https://one-image2.tangguo.xin](https://one-image2.tangguo.xin)

## 主要能力

- 对话式生成、历史会话、资产库和灵感库。
- `system` 模式使用站长配置的 Relay Key，成功落图后扣除本站积分。
- `custom` 模式使用用户保存在浏览器中的 Key，不检查或扣除本站积分，也不会回退到 `system`。
- PostgreSQL 任务队列，独立 `worker` 执行生成，单例 `scheduler` 处理超时、对账和清理。
- 本地持久化媒体、兑换码充值、积分批次、管理后台和审计记录。
- Debian Docker Compose 一键安装、升级、备份与恢复。
- 管理后台检查官方 GitHub 稳定版，并通过受限的宿主机更新器完成备份、更新和回滚。

## 生产拓扑

```text
Nginx/Caddy -> web (React Router SSR)
web/worker/scheduler -> PostgreSQL
web/worker/scheduler -> media_data
```

PostgreSQL 不发布宿主机 `5432`，Web 仅绑定安装器选择的 `127.0.0.1` 端口。生产配置保存在被 Git 忽略的 `deploy/.env.production`。

系统更新入口是 `/admin/system-update`。Web 只能写入更新请求并读取状态，不挂载 Docker socket、项目目录或宿主机 shell；实际更新由 root systemd oneshot 完成。

## 本地开发

要求 Node.js 22、npm 和可用的 PostgreSQL。根据 [.env.example](.env.example) 准备本地 `.env` 后运行：

```bash
npm ci
npm run dev
```

常用验证：

```bash
npm run typecheck
npm run test:run
npm run build
npm run assert-no-secrets
```

## 服务器部署

```bash
git clone https://github.com/Ttt599536561/image-2.git ai-image-workshop
cd ai-image-workshop

# 使用 Caddy 自动配置 HTTPS
sudo bash deploy/install.sh --domain images.example.com

# 或接入已有反向代理
sudo bash deploy/install.sh \
  --existing-proxy \
  --public-url https://images.example.com
```

完整命令、升级步骤和已知故障处理见 [Docker 部署与运维](docs/dev/deploy.md)。

## 文档

- [当前发布状态](docs/PROGRESS.md)
- [技术设计索引](docs/dev/README.md)
- [运行时与配置](docs/dev/00-overview.md)
- [运维与验证](docs/dev/10-ops-test.md)
- [产品需求规格](docs/redesign-requirements.md)
- [Key 模式产品契约](tasks/prd-user-api-key-modes.md)

## 安全边界

- 不得提交 `.env`、`deploy/.env.production` 或任何真实 Key。
- `system` Key 只能存在于服务端；custom Key 明文不得进入日志、事件、审计或 API 响应。
- 不要通过删除 `postgres_data`、`media_data` 或环境文件处理普通启动故障。
- 所有生产 Compose 命令都必须带 `--env-file deploy/.env.production`。
