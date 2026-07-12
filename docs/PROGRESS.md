# 当前状态

更新：2026-07-12。当前发布目标是 Debian 单机 Docker、自托管 PostgreSQL 与本地媒体，从空数据开始。

| 里程碑 | 状态 | 证据 |
|---|---|---|
| Self-hosted PostgreSQL | Complete | Private Compose service and persistent volume |
| Self-hosted media | Complete | Shared local volume and `/media/*` route |
| One-command Debian install | Complete | Three visible inputs; generated internal secrets |
| Backup and restore | Complete | Checked local DB/media archives; seven-copy retention |
| Deployment CI | Complete | Script contracts and empty-stack persistence smoke |
| Key modes | Complete | Fresh install enables system/custom; custom credentials are encrypted per job with zero site debit |

## 可部署结论

仓库已经具备服务器部署所需代码和文档：安装器自动生成内部密钥、迁移空 PostgreSQL、创建管理员、启动 web/worker/scheduler，并验证健康状态。宿主机不使用 `3000/5432`；域名模式使用 Caddy 的 `80/443`，现有代理模式只绑定自动选择的回环端口。

部署入口只看 [deploy.md](dev/deploy.md)。安装时输入系统 Relay Key、管理员邮箱和可见管理员密码；登录地址是 `/admin/login`。

## 服务器验收

这些是目标服务器上的操作，不是未完成代码项：

- 执行一种安装命令并确认 `/healthz=204`。
- 通过 `/admin/login` 登录，完成一次真实 system Relay 生图。
- 普通用户选择 custom，使用自己的 Key 生图并确认本站余额不变。
- 确认 `/media/*` 可读取，并在重建应用容器后仍可读取。
- 运行一次备份，并把它恢复到新的空卷完成演练。
- 配置域名/TLS、主机防火墙、监控与告警。

## 后续增强

- 把仍复用的 `netlify/functions` handler 移到平台无关目录；运行时已经不依赖 Netlify。
- 根据真实 CPU、内存、队列、Relay 和存储指标决定 worker 扩容。
- 配置加密异地备份和定期恢复演练。

多机高可用和自动异地备份不在当前单机部署范围内。
