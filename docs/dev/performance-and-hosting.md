# 生图延迟优化与部署选择

更新时间：2026-10-27（Asia/Shanghai）。此页记录本地优化与官方托管额度核查，不代表已发布到生产。

## 已实现的路径

`提交事务 → PostgreSQL 持久队列 → 10 槽持续补位 worker → Relay → 持久存图 → 原有结算事务 → 提交通知 → SSE → 页面直接显示`

- 原来的整批 `Promise.all` 屏障已移除。只领取当前能执行的任务，原子 `SKIP LOCKED` 抢占，完成一个补一个，通知断线仍按周期扫描。单任务异常不会退出整个消费者。
- 默认 `WORKER_CONCURRENCY=10` **按进程计算**；本次部署目标是一个 worker。增加副本会增加全站同时调用数，不能把两个十槽 worker 当作全站十槽。scheduler 仍为单例。
- PostgreSQL 提交后才通知。Web 共享一个 LISTEN 连接；SSE 按用户/任务范围读权威状态。15 秒恢复快照、60 秒重新鉴权；连接不通时前端回退两秒批量轮询，不取消后台任务。
- 成功状态包含图片 ID、URL、保存状态等信息，直接合并当前会话；余额和资产仍后台对账。终态不会被陈旧进行中状态覆盖，本地提交失败可由真实服务器状态纠正。
- 存储网络/文件字节 I/O 传递剩余截止时间；本地图片使用临时文件后原子不可覆盖发布。保留“持久化成功后扣费”、原有事务/账户锁/FIFO、custom 零本站扣费及终态凭据清理。
- 默认侧栏去掉旧会话列表重复读取，`loadMe` 从三次 SQL 合为一次；项目排序使用批量 SQL，通知通用列表有 owner/time 索引，资产分页上限为 100。
- 生图日志分解排队、claim、Relay、存储与结算；可选 `DB_TIMING_ENABLED=true` 记录连接等待和 SQL 时间，不记录 SQL 文本、参数、Key 或上游原始错误。默认关闭。

## 本地实测及限制

| 场景 | 旧实现 | 新实现 |
| --- | --- | --- |
| 11 个模拟任务，各固定 1000ms，错峰到达，配置 10 并发：排队 p95 | 950ms | 0ms（虚拟时钟与即时通知） |
| 同一模拟场景：全部完成 | 3000ms | 2050ms |
| 同一模拟场景：任务端到端 p95 | 1950ms | 1000ms |
| 真实 PostgreSQL + 本地开发服务器 + 浏览器，10 次小图片夹具：开始提交成功结果到 DOM 图片可见 | 原路径额外最多约 2 秒轮询等待及详情请求；未做同夹具旧版浏览器测量 | min 35ms、p50 40ms、p95/max 54ms；轮询 0、详情重取 0 |

模拟调度测试只证明本站调度不再人为占用空槽，不能外推真实上游吞吐或出图时间。浏览器数字包含夹具成功事务、通知和页面显示，不包含 Relay 生成、大图片公网下载、图片解码成本或目标云区网络。10 个样本是本地验收，不是生产 SLA。

5 万行模拟通知表的查询计划从 Seq Scan/Sort 改为 Index Scan；一次诊断执行 2.141ms → 0.046ms。该结果证明索引匹配查询，不能代表用户线上数据的稳定提速比例。

复现与证据：

- `npx vitest run src/server/generation/worker.performance.test.ts --reporter=verbose`
- `npm run test:e2e -- tests/e2e/generation-events.spec.ts --repeat-each=10 --workers=1`
- 隔离开发工作树 `.cache/logs/` 中保存调度、SSE 样本、查询计划和完整验收日志。

## 运行与升级

1. 部署迁移新增 `0010_generation_notifications.sql`（队列索引、提交通知触发器）及 `0011_read_performance.sql`（通用通知索引）。先备份，再按现有维护窗口流程迁移、启动新版本。
2. 新安装默认 worker 10 槽。已有环境文件不会自动覆盖；升级后显式设置 `WORKER_CONCURRENCY=10` 并只启动一个 worker。实际并发还受 Key/上游限流、内存与带宽限制。
3. Compose worker 直接运行 Node，并配置 init 与 6 分钟停止宽限，使停止信号直接送达消费者；停止接新任务后等待在途任务完成。崩溃中的 running 任务仍由既有 deadline 收口，不能未知状态下盲目重发上游。
4. 标准 pg 的读、事务、auth 池分别默认 4 个连接；可用 `PG_READ_POOL_MAX`、`PG_TRANSACTION_POOL_MAX`、`PG_AUTH_POOL_MAX` 调整。`PG_CONNECTION_TIMEOUT_MS=10000` 是连接取得的故障上限，不是查询超时或“生图必须十秒结束”；可设 1–60000ms。
5. SSE 返回 `Cache-Control: private, no-cache, no-store, no-transform` 和 `X-Accel-Buffering: no`，Node serve 的 compression 尊重 no-transform。Nginx/其他上层代理必须透传流；如有独立配置，对 `/api/generate-events` 关闭响应缓存和缓冲，读取超时大于 60 秒。部署后需从外网验证实际事件到达时间。
6. `.cache`/`.local` 已从 Git 和 Docker 构建上下文忽略，避免本地运行数据和缓存进入镜像。

本次不改变默认模型、画质、尺寸、5 分钟任务 deadline 或计费规则；没有调用真实收费 Relay。欲测全流程，还需在目标服务器上以相同参数测单单和十并发的生成、传输、限流率。

## 免费部署服务核查（2026-10-27）

当前项目需要常驻 Node Web、worker、scheduler、PostgreSQL 和持久图片卷。以下适配判断由本项目架构推导；额度与限制来自各平台官方文档。

| 服务 | 官方免费条件 | 本项目适配判断 |
| --- | --- | --- |
| Oracle Cloud Always Free A1 | 官方当前列 1500 OCPU 小时和 9000 GB 小时/月，Always Free 账户相当于 2 OCPU/12GB；启动盘与块存储合计 200GB。仅 home region；可能容量不足，空闲实例可能回收。 | **优先评估**：常驻 VM 可同机运行完整 Docker 栈，避免免费 Web 休眠。需实际拿到实例、核对账户配额、验证 ARM 构建和目标区域到 Relay 的速度。 |
| Render Free | Web 空闲 15 分钟休眠，恢复约一分钟；无持久磁盘，免费 Postgres 30 天到期；免费实例类型不含 background worker。 | 适合展示/短期试用，不适合当前常驻队列和低等待目标。改成外部 DB/存储也未解决 worker 与休眠限制。 |
| Koyeb Free | 单个 512MB/0.1 vCPU Web 实例；一小时无流量缩容至零，不能运行 Worker Service，也不能使用持久卷。 | 无法直接承载当前完整栈，不推荐用作十任务常驻生图服务。 |
| Railway Free | 初始 5 美元/最多30天试用，之后每月 1 美元额度，不结转。 | 可部署服务，但不能把少量额度等同整套栈长期免费；须核算持续运行成本。 |

Oracle 的旧文章常写 4 OCPU/24GB；本次按**当前 Always Free 官方文档的 2 OCPU/12GB**描述，实际以账户 Console 的 Always Free 标签和配额为准，不为拿资源自动升级付费账户。不能保证所有地区都有可创建容量。

现有安装器只支持 Debian；Oracle 常见默认镜像是 Ubuntu/Oracle Linux，因此不能把原安装命令直接照搬到任意镜像。确定实例后需选受支持系统，或针对该系统完成 Docker Compose/代理/updater 部署适配；本次没有声称 ARM 或该云环境已实际部署验收。

免费托管不包含 Relay 生图费用。机器通常不需要 GPU，因为模型运行在上游；选择区域时要同时测服务器到 Relay、用户到图片存储的链路。若免费机器拿不到或资源会休眠，无法同时承诺零成本、稳定常驻和最快出图。

官方来源：

- [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Render Free](https://render.com/docs/free)
- [Koyeb Free Instances](https://www.koyeb.com/docs/reference/instances)
- [Railway Free Trial / Free Plan](https://docs.railway.com/pricing/free-trial)

## 验收摘要

资金、权限、异常与 SSE 经过独立代码审查；审查发现的乐观缓存回滚/恢复问题已补回归并修复。浏览器回归还修复了任务计时器 SSR 秒数差异导致的水合重建，以及测试在项目排序保存前刷新页面的竞态。

正式验收命令及最终计数见 `docs/PROGRESS.md` 当日优化日志；当前生产站未访问、未发布，远程 GitHub 未推送。
