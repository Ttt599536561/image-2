# 当前状态

更新：2026-07-13。当前产品基线为 `0.2.0`，现有产品、工程、单机部署和管理后台更新需求均已实现。

| 里程碑 | 状态 | 证据 |
|---|---|---|
| 对话式生图与资产 | 已实现 | 登录会话、历史、资产库、灵感库和本地持久化媒体 |
| 积分与后台运营 | 已实现 | 成功后扣费、FIFO 批次、兑换码、套餐、审计和管理后台 |
| system/custom Key 模式 | 已实现 | 统一任务状态机；custom 每任务加密且本站零扣费 |
| 单机全自托管 | 已部署 | Debian Docker Compose、PostgreSQL 17、本地媒体和持久卷 |
| 安装、备份与恢复 | 已实现 | 三项可见输入、内部密钥自动生成、校验和与七份普通备份保留 |
| 部署 CI | 已实现 | 脚本契约、构建元数据、空栈安装和持久化 smoke |
| 管理后台稳定版更新 | 已部署 | 检查/启动页面、隔离控制目录、systemd 更新器、恢复边界和 Release CI |
| 腾讯云生产环境 | 已验证 | 容器运行、Web/PostgreSQL 健康、内外网 `/healthz` 均为 `204` |

## 当前线上实例

- 站点：[https://one-image2.tangguo.xin](https://one-image2.tangguo.xin)
- 管理员入口：[https://one-image2.tangguo.xin/admin/login](https://one-image2.tangguo.xin/admin/login)
- 系统更新入口：[https://one-image2.tangguo.xin/admin/system-update](https://one-image2.tangguo.xin/admin/system-update)
- 产品版本：`0.2.0`
- 生产提交：`c5131aaa0335250a3846c380519324fbbf4b231b`
- 入口链路：Nginx -> `127.0.0.1:18080` -> React Router SSR `web`
- 运行服务：`postgres`、`web`、`worker`、`scheduler`
- TLS：已启用并配置自动续期
- Key 配置：`CUSTOM_KEY_MODES_ENABLED=true`，custom 加密密钥已配置

## 2026-07-13 部署证据

- 升级前备份：`deploy/backups/20260713T145807Z`
- 备份校验：`database.dump`、`media.tar.gz`、`manifest.env` 全部通过 SHA-256 校验
- 容器：`postgres`、`web`、`worker`、`scheduler` 均运行；Web 与 PostgreSQL 为 healthy
- 健康检查：`http://127.0.0.1:18080/healthz` 和公开 `/healthz` 均返回 `204`
- 版本固化：Web 容器内 `APP_VERSION=0.2.0`，`APP_COMMIT_SHA` 与生产提交一致
- 后台入口：未登录访问 `/admin/system-update` 返回 `302` 到登录流程
- 更新器：`ai-image-workshop-update.path` 为 enabled/active，`ai-image-workshop-update.service` 为 enabled
- 工作树：生产仓库无未提交修改

## 发布边界

更新器代码和 CI 发布规则已经实现并部署，但 GitHub `main`、`v0.2.0` tag 与 stable/latest Release 尚未发布。
当前服务器通过 `codex/admin-system-updater` 分支完成一次性引导；这不影响线上运行。

正式发布时先把当前分支合入 `main`，再创建指向 `main` 精确提交的 `v0.2.0` tag。CI 验证版本、tag、提交归属和质量门后发布 stable/latest Release。未来后台一键更新只接受严格递增的稳定版。

## 持续运维与发布动作

以下是需要按发布或运维周期执行的动作，不代表产品功能未实现：

- 合并 GitHub 分支并发布 `v0.2.0` 基线 Release。
- 使用真实第三方 Relay 周期性检查 system/custom 的 t2i/i2i、单终态、扣费和凭据清理。
- 定期验证历史 `/media/*` 在应用容器重建后仍可读取。
- 定期执行生产备份恢复到新空卷的演练，并记录恢复时间。
- 轮换管理员凭据、撤销旧会话并复查审计记录。
- 接入长期监控、告警和加密异地备份。

## 可选增强

- 把仍复用的 `netlify/functions` handler 移到平台无关目录；Docker 运行时已经不依赖 Netlify。
- 根据真实 CPU、内存、队列、Relay 和存储指标决定 worker 扩容。
- 多机高可用和自动异地备份不属于当前单机部署基线。

部署、升级、发布和故障恢复只看 [Docker 部署与运维](dev/deploy.md)；自动与人工验收范围见 [运维与验证](dev/10-ops-test.md)。
