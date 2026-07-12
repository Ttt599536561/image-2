# 当前状态

更新：2026-07-13。当前发布形态是 Debian 单机 Docker、自托管 PostgreSQL、本地媒体、system/custom 双 Key 模式，以及管理后台稳定版更新器。

| 里程碑 | 状态 | 证据 |
|---|---|---|
| Self-hosted PostgreSQL | Complete | Private Compose service and persistent volume |
| Self-hosted media | Complete | Shared local volume and `/media/*` route |
| One-command Debian install | Complete | Three visible inputs; generated internal secrets |
| Backup and restore | Complete | Checked local DB/media archives; seven-copy retention |
| Deployment CI | Complete | Script contracts and empty-stack persistence smoke |
| Key modes | Complete | Fresh install enables system/custom; custom credentials are encrypted per job with zero site debit |
| Production infrastructure | Deployed | Nginx forwards HTTPS traffic to the healthy loopback Web service; functional acceptance remains |
| Site favicon | Complete | `/favicon.svg?v=1` is linked globally and served from the production domain |
| Admin stable updater | Complete | Admin check/start UI, isolated control mounts, guarded systemd update and recovery, monotonic Release CI |

## 当前线上实例

- 站点：[https://one-image2.tangguo.xin](https://one-image2.tangguo.xin)
- 管理员入口：[https://one-image2.tangguo.xin/admin/login](https://one-image2.tangguo.xin/admin/login)
- 入口链路：Nginx -> `127.0.0.1:18080` -> React Router SSR `web`
- 服务：`postgres`、`web`、`worker`、`scheduler`
- TLS：已启用并配置自动续期
- 生产代码版本：`cbb5a78`（站点 favicon）
- Key 配置：`CUSTOM_KEY_MODES_ENABLED=true`，custom 加密密钥已配置且完成加解密往返检查

线上基础设施已经完成镜像重建、数据库迁移、容器健康检查、管理员登录页检查、favicon 内容一致性检查。真实生图与恢复演练仍按下文验收，生产环境文件和真实 Key 不进入 Git。

## 发布结论

仓库已经具备服务器部署所需代码和文档：安装器自动生成内部密钥、迁移空 PostgreSQL、创建管理员、启动 web/worker/scheduler，并验证健康状态。宿主机不使用 `3000/5432`；域名模式使用 Caddy 的 `80/443`，现有代理模式只绑定指定或自动选择的回环端口。

部署、升级和已知故障处理只看 [deploy.md](dev/deploy.md)。安装时输入系统 Relay Key、管理员邮箱和管理员密码；登录地址是 `/admin/login`。

## 仍需人工验收

以下项目需要真实第三方 Relay、用户 Key 或维护窗口，不以容器健康代替：

- 完成一次真实 `system` 生成，确认只产生一个终态、一张图片和最多一次 debit。
- 完成一次真实 `custom` 生成，确认本站余额不变、无 debit，并在终态删除临时凭据。
- 确认历史 `/media/*` 在应用容器再次重建后仍可读取。
- 执行一次生产备份，并恢复到新的空卷完成演练。
- 接入长期监控、告警和加密异地备份。

## 后续增强

- 把仍复用的 `netlify/functions` handler 移到平台无关目录；Docker 运行时已经不依赖 Netlify。
- 根据真实 CPU、内存、队列、Relay 和存储指标决定 worker 扩容。
- 配置加密异地备份和定期恢复演练。

多机高可用和自动异地备份不在当前单机部署范围内。
