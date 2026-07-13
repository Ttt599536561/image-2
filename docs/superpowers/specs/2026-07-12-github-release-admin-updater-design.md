# GitHub Release 管理员一键更新设计

日期：2026-07-12
状态：本文范围已在 `0.2.0` 实现，并于 2026-07-13 在腾讯云生产环境完成引导部署。

## 实现结果

管理后台 `/admin/system-update`、严格 Release 检查、原子请求/状态、维护中间件、受限宿主机更新器、systemd units、备份 pin、回滚/恢复边界和 GitHub Release CI 均已交付。生产提交为 `c5131aaa0335250a3846c380519324fbbf4b231b`，`.path` 为 enabled/active，service 为 enabled，内外网 `/healthz` 均返回 `204`。

GitHub `main`、`v0.2.0` tag 与 stable/latest Release 尚未发布；这是发布操作状态，不是功能缺口。完成基线 Release 后，后台正常一键更新从更高的稳定版本开始。生产证据见 [PROGRESS.md](../../PROGRESS.md)，命令见 [deploy.md](../../dev/deploy.md)。

## 1. 目标

在管理员后台增加“系统更新”页面。站长可以主动检查官方 GitHub 仓库是否发布了更高的稳定版本；发现新版本后，经二次确认即可启动整站更新。更新过程必须先排空生成任务并备份，再获取精确 Release Tag、构建镜像、执行数据库迁移、重启服务和健康检查。

更新能力只属于部署并管理站点的管理员。普通注册用户不能查看或触发更新。

## 2. 已确认约束

- 当前产品是 Debian 上运行的 Docker Compose 自托管 Web 应用，不是桌面客户端。
- 官方更新源固定为公开仓库 `Ttt599536561/image-2`。
- 最新版只认稳定 GitHub Release；草稿和预发布版本均忽略。
- Release Tag 使用稳定 SemVer：`vMAJOR.MINOR.PATCH`。
- 管理员接受更新期间数分钟的维护窗口和短暂断线。
- Web 容器继续以非 root 用户运行，不挂载 Docker Socket，也不直接取得宿主机 Shell 权限。
- 已有部署允许执行一次终端引导；之后的版本可在后台一键更新。
- 迁移开始前的失败必须自动恢复旧 commit 和原服务；若旧服务自身也无法恢复健康，则保留明确失败状态和诊断信息。迁移开始后的失败不盲目重试，必须保留现场并提供受控恢复命令。

## 3. 非目标

- 不允许管理员在网页中配置任意仓库、分支、Tag、脚本或命令。
- 不支持普通用户更新自己的浏览器副本；一次更新作用于整个站点。
- 不跟踪 `main` 分支提交，不安装未发布代码，不提供预发布通道。
- 不在后台静默自动安装版本；每次更新必须由管理员主动确认。
- 不承诺非 Debian、非 systemd 或多主机集群的一键更新。
- 不把 Docker Socket、宿主机项目目录或 root 凭据暴露给 Web 容器。

## 4. 版本与发布契约

### 4.1 当前版本

构建时把以下只读元数据写入运行镜像：

- `APP_VERSION`：来自 `package.json` 的 SemVer，例如 `0.2.0`。
- `APP_COMMIT_SHA`：构建提交的完整 SHA；界面只显示短 SHA。

管理员 API 和页面从这两个值读取当前版本，不从浏览器缓存或数据库推断版本。非 Release 构建仍显示包版本和 SHA；比较更新时忽略 SemVer build metadata，绝不降级到相同或更低版本。

### 4.2 GitHub Release

检查接口固定调用：

`GET https://api.github.com/repos/Ttt599536561/image-2/releases/latest`

服务端设置 GitHub JSON Accept 头、固定 API 版本、连接和总请求超时，并使用 ETag 与五分钟缓存减少匿名限额消耗。`404` 表示尚无稳定 Release，不伪装成网络故障。响应必须通过结构校验，并同时满足：

- `draft === false`
- `prerelease === false`
- `tag_name` 严格匹配 `vMAJOR.MINOR.PATCH`
- `html_url` 的主机与仓库路径属于固定官方仓库
- 目标版本严格高于当前版本

Release 正文只作为纯文本摘要展示，React 必须转义内容；完整说明通过校验后的 GitHub 链接打开，不能渲染远端 HTML。

### 4.3 发布工作流

本功能随 `0.2.0` 基线交付。以后推送 `vX.Y.Z` Tag 时，GitHub Actions 必须先校验 Tag 与 `package.json` 完全一致，并且严格高于当前最新稳定 Release，再运行类型检查、单元测试、构建、秘密扫描、Compose 校验和部署脚本测试。全部通过后才使用仓库自带的 `gh` CLI 创建并标记新的 Latest 稳定 Release；失败时不得创建 Release。这个单调递增约束保证 GitHub 的 `latest` 语义不会把较低版本误当成目标。

仓库当前没有 Tag 或 Release，因此实现代码本身不会把任意 `main` 提交当成可更新版本。创建远端 Tag/Release 属于后续明确的发布操作，不由本地实现隐式执行。

## 5. 总体架构

```text
管理员浏览器
    |
    | 管理员会话 + 同源 POST
    v
非特权 Web 容器
    |-- GitHub Release 客户端（只读、固定仓库）
    |-- 管理员更新 API
    |-- 请求 inbox（只写固定 JSON）
    `-- 状态目录（只读）
             |
             | systemd PathExists 触发
             v
Debian 宿主机 root 更新器
    |-- 固定官方 Release 再校验
    |-- 全局部署锁
    |-- 维护模式与任务排空
    |-- 备份、Git、Docker Compose、迁移、健康检查
    `-- 原子写入脱敏状态
             |
             +--> PostgreSQL / media_data 持久卷
             `--> GitHub 官方仓库
```

### 5.1 权限分离

宿主机创建两个目录：

- `/var/lib/ai-image-workshop-updater/inbox`：仅 Web 容器中的 Node 用户可创建固定请求文件，宿主机更新器读取并移走。
- `/var/lib/ai-image-workshop-updater/state`：仅 root 更新器可写，Web 容器只读挂载。

Web 服务不能修改 systemd Unit、更新器配置、项目路径或状态文件。宿主机配置保存在 root 所有、不可由容器写入的配置文件中，固定记录项目绝对路径与官方仓库。Web 进程即使被攻破，也最多重复请求“升级到严格更高的官方最新稳定版”，不能提交任意 root 命令。

### 5.2 systemd 组件

一次性引导安装：

- root 所有的稳定更新入口 `/usr/local/sbin/ai-image-workshop-update`
- `ai-image-workshop-update.path`，监听固定 `request.json` 是否出现
- `ai-image-workshop-update.service`，以 `Type=oneshot` 执行固定的 `process-request` 子命令
- root 所有的项目配置和状态目录

Unit 使用最小能力与文件系统保护选项，但必须保留访问 Git、项目目录、备份目录和 Docker CLI 所需的权限。服务不接受来自请求文件的路径、URL 或 Shell 片段。

## 6. Web API 与数据契约

### 6.1 路由

- `GET /api/admin/system-update`：返回当前版本、更新器可用性、宿主机状态和缓存的最新 Release。
- `POST /api/admin/system-update/check`：强制重新检查一次 GitHub，仍遵守 ETag、超时和服务端节流。
- `POST /api/admin/system-update`：只接受 `{ "action": "start" }`，不接受目标版本或仓库参数。

三个路由都必须独立执行管理员守卫。两个 POST 还必须要求 JSON Content-Type、校验 `Origin` 与站点公开源一致，并采用现有客户端 IP/节流边界。启动更新前先写管理员审计；审计失败则不创建 root 请求。

### 6.2 请求文件

Web 在 inbox 内使用临时文件加原子重命名创建唯一的 `request.json`。文件有大小上限、禁止符号链接，结构固定为：

```json
{
  "protocolVersion": 1,
  "requestId": "UUID",
  "requestedAt": "ISO-8601 timestamp",
  "requestedBy": "admin user id"
}
```

`requestedBy` 只用于审计关联，不参与宿主机授权。宿主机忽略其他字段并拒绝未知键、重复请求、过大文件、非普通文件和协议版本不匹配。

### 6.3 状态文件

root 更新器使用临时文件加原子重命名写 `status.json`。字段只包含：协议版本、请求 ID、当前/目标版本、阶段、维护状态、起止时间、最后更新时间、脱敏错误代码与消息、备份标识和受控恢复命令。状态不得包含环境变量、密钥、完整 GitHub 响应、完整 Shell 命令输出或数据库连接串。

Web 读取状态时限制文件大小、拒绝符号链接并做结构校验。协议不兼容或状态损坏时，后台禁用更新并提示站长先执行终端引导，不猜测执行状态。

## 7. 更新执行流程

### 7.1 检查更新

1. 管理员打开 `/admin/system-update`，页面显示镜像内的版本和 SHA。
2. 点击“检查更新”后，Web 服务查询固定 GitHub Release 接口。
3. 无 Release、版本相同或目标更低时显示“已是最新版本”。
4. 严格更高的稳定版本通过校验后，显示版本、发布时间、纯文本摘要和 GitHub 发布说明链接，并启用“立即更新”。

### 7.2 创建请求

1. 管理员在确认弹窗中看到目标版本、预计维护窗口、自动备份和断线重连说明。
2. Web API 再次检查管理员、同源请求、更新器状态、当前无活动请求，并重新确认目标版本仍严格更高。
3. Web 写审计记录，然后原子创建固定请求文件。
4. API 返回 `202 Accepted` 与请求 ID；重复启动返回 `409 Conflict`。

### 7.3 宿主机预检与排空

1. systemd 更新器取得现有安装/备份/恢复共用的全局 `flock`；已有运维操作时拒绝执行。
2. 在 inbox 的固定请求文件仍占位时，更新器先原子写入 active 状态，再把请求移入 root 专用工作目录。这样第二个 Web 请求在任何时刻都只能看到“请求文件存在”或“active 状态”之一，不存在可插入重复请求的空窗。
3. 更新器读取 root 配置和当前包版本，再独立查询官方最新稳定 Release。
4. 请求只能升级到此刻的官方最新版本；目标必须严格高于当前版本，Tag 与 Release 必须一致。
5. 更新器检查 Git 工作区的已跟踪文件与索引无本地修改。它绝不执行 `git reset --hard`、`git clean` 或覆盖本地修改。
6. root 状态切换为维护模式。Web 的统一写请求守卫读取只读状态，除更新状态 GET 外，对所有新的 POST/PUT/PATCH/DELETE、上传、鉴权写入和管理员写操作返回明确的 `503 maintenance`；普通只读页面暂时仍可访问。
7. worker 和 scheduler 继续处理已有 `queued/claimed/running` 任务。更新器最多等待五分钟直至活动数为零；超时则退出维护模式并保持旧版本运行。进入备份前，Web、worker 和 scheduler 全部停止，因此备份完成后不会再出现数据库或媒体写入。

### 7.4 备份与准备回退点

1. 调用现有 `deploy/backup.sh`，复用全局锁并保持 web、worker 和 scheduler 停止。
2. 校验备份目录、`SHA256SUMS`、数据库 dump 和媒体归档。
3. 记录旧 Git commit、原运行服务集合和当前应用镜像 ID。
4. 给旧镜像增加只供本次恢复使用的请求级 Tag；成功更新后删除，失败时保留。

### 7.5 获取并安装 Release

1. 使用硬编码 HTTPS 官方仓库 URL 获取精确 Release Tag，不执行 `git pull main`。
2. 校验 Tag、`package.json` 版本和 Release 版本完全一致。
3. 记录旧 commit 后切换到精确 Release commit；冲突时安全失败，不清理文件。
4. 以目标版本和 commit 作为构建参数构建新镜像。
5. 运行现有生产迁移命令。每个迁移文件继续在独立数据库事务内执行。
6. 使用新镜像重建 web/worker/scheduler，按当前配置处理 Caddy，然后等待 `/healthz` 返回 204。
7. 成功后写完成状态、退出维护模式、删除 root 工作目录中已认领的请求和旧镜像恢复 Tag，并更新稳定宿主机入口供下一版本使用。inbox 请求已在执行开始时移走，不会让 Path Unit 重复触发。

页面在执行中每两秒轮询。Web 重启造成的请求失败显示“服务重启中”，不能误报更新失败；新 Web 上线后读取宿主机状态并显示新版本。浏览器从启动响应中保留请求 ID；若超过健康检查上限仍无法连接，它只显示“无法确认结果”和固定兜底命令 `sudo /usr/local/sbin/ai-image-workshop-update status REQUEST_ID`，不得自行判断更新已失败。

## 8. 失败与恢复

### 8.1 迁移前失败

GitHub、工作区、任务排空、备份、获取或构建失败都属于迁移前失败。更新器必须：

- 恢复旧 Git commit；
- 保持或启动原服务集合；
- 确认旧 `/healthz` 恢复；
- 退出维护模式；
- 写入失败阶段和脱敏原因；
- 保留已生成的正常备份，但不要求数据库恢复。

### 8.2 迁移开始后失败

生产迁移按文件分别提交，后续文件失败时可能已有前序文件生效，因此不能仅切回旧代码并宣称恢复。迁移或新版本健康检查失败时：

- 停止自动重试；
- 保留全局状态、旧 commit、旧镜像恢复 Tag 和已校验备份；
- 保持生成入口处于维护状态；
- 页面显示 `recovery_required`、失败阶段、备份标识，以及固定命令：

```bash
sudo /usr/local/sbin/ai-image-workshop-update recover REQUEST_ID
```

恢复子命令只接受当前 root 状态中唯一的请求 ID，并要求终端输入可见确认串 `RECOVER ai-image-workshop`。它重新校验备份，停止应用 writers，用 `pg_restore --single-transaction --clean --if-exists --no-owner --no-privileges` 把数据库恢复到升级前快照，再以保留的旧镜像和旧 commit 启动原服务并检查健康。维护模式已阻止全部 HTTP 写入，且备份前已停止全部容器 writers，因此数据库恢复成功时无需覆盖媒体卷；媒体归档仍保留用于灾难恢复。恢复成功后状态改为 `recovered`，才允许再次更新。

若新 Web 完全无法启动，已打开的浏览器只能显示上述 `status REQUEST_ID` 兜底命令，不能直接读取 root 状态。`status` 子命令负责输出当前阶段，并且只在状态确认为 `recovery_required` 时打印对应的 `recover REQUEST_ID` 命令。若 Web 能恢复响应，后台页面才直接展示同一恢复信息。

恢复失败时继续保持 writers 停止和维护状态，不删除备份、不删除旧镜像 Tag，也不循环尝试。

## 9. 管理员界面

后台侧边栏增加带 `RefreshCw` 图标的“系统更新”，路由为 `/admin/system-update`。页面延续现有后台的紧凑样式，不向普通用户端增加入口。

页面包含：

- 当前版本、短 commit SHA 和构建信息；
- 最新稳定版本、发布时间、摘要和 GitHub 链接；
- “检查更新”与“立即更新”命令按钮；
- 更新器就绪、工作区、本地任务和当前运维锁等预检结果；
- 等待、排空、备份、获取、构建、迁移、重启、健康检查、完成/失败阶段；
- 连接中断后的自动轮询，以及无法恢复连接时基于请求 ID 的终端状态命令；
- 恢复所需的备份标识和固定终端命令。

只有发现严格更高的稳定版本且更新器就绪时才能点击“立即更新”。活动请求期间禁用两个命令按钮。确认弹窗明确提示备份、维护窗口和暂时断线，不要求管理员输入 GitHub Token。

桌面使用现有后台双栏布局；移动端隐藏固定侧栏并保证版本、阶段、按钮和长错误文本不溢出或互相覆盖。

## 10. 安装与兼容

全新 Debian 安装会在启动应用前创建控制目录和只读/可写挂载，在站点健康后启用 systemd Path Unit。

已有部署需最后执行一次：

```bash
git pull --ff-only
sudo bash deploy/install.sh --upgrade
```

这次人工升级负责安装宿主机更新器并部署带管理页面的新版本。以后不再依赖 `git pull main`，而是由更新器获取精确稳定 Tag。

本地开发、CI 或没有 systemd 更新器的环境仍可打开后台页面，但 API 返回 `enabled: false`，页面只显示当前版本和一次性启用说明，不能创建请求。Compose 的控制目录路径可由受保护的部署配置覆盖，以便 CI 使用临时目录；生产安装器固定写入 `/var/lib/ai-image-workshop-updater`。

## 11. 测试策略

### 11.1 TypeScript 单元测试

- 稳定 SemVer 解析、严格升版和不降级行为；
- GitHub 成功、无 Release、草稿/预发布、非法 Tag、超时、限额和缓存/ETag；
- 请求/状态 JSON 的大小、未知键、协议版本、符号链接与脱敏；
- 非管理员拒绝、POST 同源校验、重复请求 `409`、未安装更新器和活动状态；
- 维护状态阻止所有 HTTP 写请求，并允许更新状态 GET 继续轮询；
- 管理页面的无更新、有更新、执行、断线、成功、失败和恢复提示状态。

### 11.2 Shell 契约测试

使用临时仓库及假的 `curl`、`git`、`docker`、`systemctl` 和 `flock`，验证：

- systemd 文件、root 配置、目录权限和挂载边界；
- 固定官方仓库、严格 Tag、拒绝任意参数和协议错误；
- 全局锁与重复/旧版本请求不执行升级；
- 请求认领无竞态，以及维护、排空、停止全部 writers、备份、获取、构建、迁移、重启和健康检查的顺序；
- 迁移前失败恢复旧 commit、旧服务与健康状态；
- 迁移后失败保留备份/旧镜像并进入 `recovery_required`；
- 恢复子命令的请求 ID、确认串、校验、数据库恢复、旧镜像启动和失败保护；
- 日志和状态不出现环境密钥、数据库 URL 或 Relay Key。

测试专用依赖注入只能在显式测试模式和临时目录中生效；生产模式始终忽略仓库、项目路径和命令覆盖变量。

### 11.3 集成与视觉验证

- React Router API 与管理员页面测试覆盖权限和状态轮询。
- Compose smoke 创建临时控制目录，验证新挂载不会破坏 web/worker/scheduler 和持久卷。
- 在桌面与移动视口用 Playwright 截图检查页面、确认弹窗、长版本号和错误文本无重叠。
- Debian 验收环境完成一次从旧稳定 Tag 到新稳定 Tag 的真实更新，以及一次受控的迁移后恢复演练。
- 最终运行 `npm run typecheck`、`npm run test:run`、`npm run build`、`npm run assert-no-secrets`、`npm run docker:validate` 和 `npm run test:deploy`。

## 12. 验收标准

1. 普通用户不能看到更新入口，调用相关 API 得不到管理员数据或执行能力。
2. 管理员能看到准确的当前版本，并能区分无 Release、已是最新、发现更新和检查失败。
3. 页面只允许启动官方最新稳定版本；请求中不存在可控仓库、Tag、路径或命令。
4. Web 容器没有 Docker Socket、项目目录或 root 配置写权限。
5. 维护开始后没有新的 HTTP 写入，已有生成任务在限定时间内排空，全部容器 writers 在备份前停止，备份在任何迁移之前完成。
6. 正常更新后服务健康、版本变更、PostgreSQL 与媒体数据保持，浏览器能在重启后恢复状态；无法重新连接时只提示查询状态，不误报成败。
7. 迁移前失败自动恢复旧服务；迁移后失败保留全部恢复材料，并通过可用的后台页面或 `status REQUEST_ID` 给出真实可执行的受控恢复命令。
8. 并发点击、重复请求、同版本请求、GitHub 故障、本地修改和已有运维锁都安全失败且不触发降级或覆盖。
9. 状态、日志、API 和前端构建不泄露任何部署秘密。
10. Tag 与包版本不一致或质量门禁失败时，GitHub 不会产生稳定 Release。
