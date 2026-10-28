# AI 图像工坊

<p align="center">
  <img src="public/favicon.svg" width="96" height="96" alt="AI 图像工坊图标" />
</p>

AI 图像工坊是无需注册或登录的图片创作工作台。填写自己的图片服务 URL 与 API Key，即可使用 `gpt-image-2` 文生图或图生图；站内不再提供套餐、积分或充值。

已部署站点：[https://one-image2.tangguo.xin](https://one-image2.tangguo.xin)

当前代码版本为 `0.3.0`。部署目标是 `45.207.199.3` 的 Docker Compose 环境；实际部署提交、版本与验收证据以[当前状态](docs/PROGRESS.md)为准。

## 主要能力

- 首页直接进入三栏工作台：菜单、参数面板、大幅结果画布；支持手机布局和明暗主题。
- 提示词、真实像素尺寸、画质与背景选项，上传/拖入/粘贴参考图，下载原图、放大和复用参数。
- 所有生成使用用户自己的 URL＋Key，不回退站长 Key。默认 Key 仅当前页面会话，显式勾选后才保存在此浏览器。
- 历史与图片 Blob 保存在本机 IndexedDB（最多50条/200MiB），刷新恢复任务，不跨设备同步；重要作品请下载留存。
- 匿名 HttpOnly 会话隔离任务与图片；任务凭据加密并在终态销毁。服务器生成图片临时保留7日，浏览器已缓存的副本独立保留。
- PostgreSQL 持久任务队列与十槽 worker，SSE 即时更新及轮询恢复；scheduler 只负责任务超时、凭据和媒体清理。
- HTTPS 上游的公网 DNS/IP 检查、固定连接地址、禁止重定向、请求与图片体积限制。
- Debian Docker Compose 一键安装、升级、备份与恢复。
- 管理后台检查官方 GitHub 稳定版，并通过受限的宿主机更新器完成备份、更新和回滚。

## 生产拓扑

```text
Nginx/Caddy -> web (React Router SSR)
web/worker/scheduler -> PostgreSQL
web/worker/scheduler -> media_data
```

PostgreSQL 不发布宿主机 `5432`，Web 仅绑定安装器选择的 `127.0.0.1` 端口。生产配置保存在被 Git 忽略的 `deploy/.env.production`。

自定义反向代理必须覆盖 `X-Studio-Client-IP` 为真实连接来源，不能透传客户端提供的同名头；内置 Caddy 已配置。用户媒体必须经 Web 校验匿名会话，不应恢复旧版本的 Caddy `/media/*` 静态直出。公开 origin 使用 `STUDIO_PUBLIC_ORIGIN`，未设置时沿用 `BETTER_AUTH_URL`。

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
- [Docker 部署与运维](docs/dev/deploy.md)
- [运维与验证](docs/dev/10-ops-test.md)
- [产品需求规格](docs/redesign-requirements.md)
- [Key 模式产品契约](tasks/prd-user-api-key-modes.md)

## 安全边界

- 不得提交 `.env`、`deploy/.env.production` 或任何真实 Key。
- URL 与 Key 按任务加密冻结，明文不得进入日志、事件、审计、历史或状态 API 响应；公开接口不允许 `system` 模式。
- 不要通过删除 `postgres_data`、`media_data` 或环境文件处理普通启动故障。
- 所有生产 Compose 命令都必须带 `--env-file deploy/.env.production`。
