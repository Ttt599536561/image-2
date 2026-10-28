# 进度交接日志

> 本文件是 AI 的"交接班记录本"。每次关会话前 AI 必须在"会话日志"区
> 顶部追加一条固定格式的记录。出处：Anthropic《Effective Harnesses for
> Long-Running Agents》的 progress file + git history 双保险机制。

## 当前状态速览

> 最后更新：2026-10-29（0.3.3已上线，生产运行0cc1f21，4MiB公网复验通过）

- 现在做到哪：
  - 0.3.4 / F-081：按用户新要求改回整图单次上传，不自动分片/重试；20分钟收图/21分钟浏览器与HTTP入口，明确失败立即返回。本地882单测、19E2E及typecheck/build通过，生产仍为下述0.3.3，待发布。
  - 0.3.3 / F-080：64KiB分片与有界重试已上线；851单测、123真库、17E2E及CI通过。4MiB公网592.4秒完整上传，11次真实失败均恢复，服务器实际字节SHA一致。线路仍慢，未声称带宽改善。
  - 0.3.2 / F-079：立即显示任务、后台上传、失败保留原任务重试及120秒上传预算已上线；本地792单测、16项E2E及CI通过，生产922428B限速上传44.45秒返回200，桌面/手机即时任务验证通过。
  - 0.3.1：F-078紧凑控制区、双模型、固定URL、美化选择器和4参考图已完成验收、独立审查、GitHub CI及生产更新。
  - 0.3.0：F-077无需普通账户的URL＋Key工作台已完成本地验收、独立审查、GitHub CI和生产更新；三栏大结果区、IndexedDB历史、匿名会话隔离、SSRF防护和旧计费入口退役均已上线。
  - 当前生产：`45.207.199.3` 的 `/opt/ai-image-workshop` 运行 `0cc1f2116f7d1fad077cdeb29685200349e4e851`（`0.3.3`），域名 `https://one-image2.tangguo.xin`。15个迁移、五服务正常；health204、4MiB公网分片/重放/原图SHA通过，桌面与手机交互验收保留。此为main部署，未额外创建GitHub稳定版tag。
  - 代码线：本地 main 已完成 /welcome 公开落地页、三轮视觉改版
    （F-070/F-071）、方案 B（F-072：根路径即门面）、F-073（管理后台
    手动配置未登录首页画廊）、v0.2.8 文案两条（资产库 7 天提示 + 兑换码
    获取链接），以及 **F-074/F-075 侧边栏项目分组会话与长按拖动排序**
    （0777353，已随 v0.2.9 上线）。2026-10-27 基于 e9f41c6 完成 F-076：持续补位 worker、原子抢占、存储 deadline、提交通知/SSE、即时结果合并与读路径优化，本地已验收。
  - 旧机历史发布线：**生产已跑 v0.2.9**（2026-07-26 第二次受控更新，
    0.2.7 → 0.2.9 跨版本直升：v0.2.8 文案两条 + F-074/F-075 侧边栏
    项目分组；迁移 0009 已应用，存量会话自动归档默认项目；公网
    /healthz 204、/welcome 200）。首次受控更新（2026-07-25，
    0.2.0 → 0.2.7）曾连续修复三个宿主环境潜伏缺陷（jq 1.6 校验、
    /root/.docker 只读、UMask=0077 镜像权限），对应 v0.2.4/v0.2.5/v0.2.7
    三个补丁发布。
- 下一步做什么：F-080修复与部署完成。用户刷新页面后重新粘贴参考图提交；原图不压缩、最多4图/每图4MiB。公网线路仍有波动与慢传，失败最多3次自动尝试后保留原卡手动重试；总会话固定20分钟。没有使用真实API Key或调用付费生成，模型权限和额度仍由用户服务决定。
- 已知风险/坑：
  - 2026-10-28：本机物理网卡直连及SSH隧道的不限速大上传仍出现连接重置、服务端未收齐请求体；同图32KiB/s探针44.45秒成功，服务器内部完整HTTPS上传222ms成功。Caddy/tc无带宽限速，本轮不改运营商/本机代理线路。线上浏览器检查经临时SSH SOCKS通道完成，图片上传被拦截、未提交付费生成。
  - e2e key-modes 在本机已从"偶发超时"变为高频失败：2026-07-25 对照实验
    显示**无改动的基线（494e819）同样失败**（断言 已完成 toHaveCount(2) → 0），
    判定为本机 Windows dev 轮询环境问题，非产品缺陷；建议后续在 CI/Linux
    跑 e2e（判定规则见 VERIFY.md 第三节）。
  - 当前 E 盘 `.env` 使用 55432/image2_local；优化工作树 `.env.test` 使用独立 55432/image2_performance_test（迁移至0011）、E2E 18900。资金/E2E 不得复用开发库。5433/ai_image_dev 与 ai_image_test 是 7 月旧环境记录。
  - 本项目通过 `.local/environment.ps1` 使用项目缓存内 Node 22.23.4；系统 Node 24 不作为本项目运行基线。
  - 宿主 systemd 单元 UMask=0077：生产树文件仍是 600/700 混合权限——
    无害（v0.2.7 Dockerfile 已归一化镜像内权限，后续更新不受影响），
    不要去手动 chmod 生产树（deploy/backups 必须保持私有）。

## 会话日志（新条目追加在最上面，必须按此格式）

### [2026-10-29] F-081整图单次上传：本地实现与回归
- 用户明确要求直接一次传整图、不要切片、失败直接返回并延长上传时间。新版uploadReference只发送一次FormData到原uploads接口，不重试、不回退分片；HTTP明确错误不等错误响应体，成功回执有完整读取期限。仍保持点击先显示任务、四图按序、原图不压缩、手动重试原任务ID/已传图片复用。
- 上传预算：应用收图20分钟、浏览器21分钟覆盖保存/响应。发现react-router-serve默认Node请求5分钟会抢先超时，因此引入scripts/web.mjs/web-server.mjs正式HTTP入口（requestTimeout21分钟、headersTimeout60秒），沿用原RR Express handler/static immutable/gzip/morgan/shutdown；将5项已有间接依赖提升为直接依赖，没有新增包版本。JSON仍15秒、文件4MiB/4张及归属/同源/限流保持；旧分片表/清理保留，不用删数据实现回退。
- 测试先红后绿：整图客户端29项、服务端应用/生产HTTP18项通过，客户端目录117项通过。完整unit103文件/882 passed、1 skipped；typecheck退出0；完整E2E19 passed（2.1m）：真实粘贴1,371,573字节图片单POST原图SHA一致，503/断连各单次失败、0生成/0分片，四图/手动重试ID保持。临时独立Vite配置解决worktree依赖junction，未改产品开发配置。
- build及产物扫描45文件/4密钥值/9结构标记通过；audit高危门禁退出0（4项已有开发依赖中危）。独立测试库image2_whole_test、端口18921、所有新缓存/测试产物在E盘。实际生产启动smoke已通过（Node22、构建产物、health204/home200/静态资源200，单次PNG保存字节一致，无生成）；独立审查无P1/P2。下一步CI与受控更新。未使用真实Key或调用付费生成。

### [2026-10-29] 0.3.3分片恢复正式收口：4MiB公网验收通过
- 代码afd3361及TTL补丁0cc1f21均已推送main，[补丁CI](https://github.com/Ttt599536561/image-2/actions/runs/40723779263)全绿。生产运行0.3.3/0cc1f2116f7d1fad077cdeb29685200349e4e851；upgrade.state complete/status0，health204，15个迁移、五服务运行正常。未创建新stable tag。
- 公网真实验收：新会话4,194,304字节有效PNG，共64片，592.400秒完成；81请求中11次真实网络失败（502×3、curl28×7、curl55×1）均被最多3次尝试恢复。创建/分片/完成重放均通过；SSH读取实际存储文件，字节数与SHA256=4c77e8aa6a85de4d1954a0800c5f7ea3d76ade617a59f666b6b46e7eb7502b96一致。probe退出0，精确媒体key、会话、分片及本地Cookie均清理。证据`.cache/logs/deployment/chunk-production-2026-10-28T16-21-44-841Z-4a003b8e/summary.json`。
- 最终验收均退出0：typecheck；test:run为102文件/851 passed、1 skipped；test:money为21文件/123 passed；test:e2e为17 passed（3分钟，临时worktree依赖路径配置说明见前条）；build；密钥扫描45文件/4项值/9标记；audit高危门禁（4项既有开发依赖中危）。客户端时钟偏差、后端租约内存/迟到回写及TTL边界均已修复并复查，无未关闭P1/P2。
- 回退：最初升级前备份deploy/backups/20261028T154502Z、TTL补丁前备份20261028T161939Z三项checksum均OK；私有配置chunk-0.3.3-before.env及镜像rollback-before-chunk-20261028保留。新镜像别名ai-image-workshop:0.3.3-0cc1f21。
- 清理与边界：独立E盘测试库/工作树已删除、分支已合并后删除，共享依赖缓存复用；本地日志/截图归档到`.cache/logs/deployment/chunk-local-verification`。公网测试是固定目标HTTPS，不宣称绕过TUN；仍存在慢传和链路波动，不声称所有网络故障消失。未使用真实Key或发真实付费生成；用户需刷新旧页面后重新粘贴图片提交。

### [2026-10-29] F-080公网验收发现总TTL边界并修正
- 0.3.3/afd3361已完成CI #40717679325及受控升级，0014应用、五服务正常、health204。备份deploy/backups/20261028T154502Z三项SHA均OK，回退镜像rollback-before-chunk-20261028。
- 固定目标HTTPS公网探针：1,371,573字节合成PNG经实际断连/超时恢复，267.223秒完成200并成功重放完成请求；4MiB到第62片达到固定10分钟TTL返回410，整体验收明确未通过。两张测试媒体及会话已精确清理，证据chunk-production-2026-10-28T15-50-23-163Z-09b49459；不能把此次失败写为4MiB通过。
- 根据实测把会话固定TTL调至20分钟，保持每片15秒、有界重试、4/8/40容量、不随重放续期。新增真PG慢传回归旧版410失败，新版通过；含该用例16项全绿，typecheck退出0。待补丁部署后重验4MiB并立即逐图SHA核对。

### [2026-10-28] F-080分片上传恢复：本地实现与验收
- 用户确认采用分片重试方案。64KiB分片、SHA校验、固定uploadId、至多3次尝试、过期受限重建；原图不压缩，现有任务ID/四图顺序/Key快照保持。旧multipart兼容。
- 0014新增PG暂存会话/分片，owner/IP/global容量4/8/40（含未清理过期片），独立分片限流、固定10分钟TTL、每分钟清理；完成用稳定key、45秒独占token租约和全局4并发保护，30秒存储I/O不持数据库锁，迟到finalizer不能污染新状态。
- 验证：全量真库`npm run test:money`退出0，21文件/122项通过；包含15项分片原子/重放/跨owner/容量/4MiB/崩溃/旧租约用例。全量浏览器17项通过（3分钟），1,371,573字节有效PNG粘贴后模拟服务器收片但响应丢失，恢复后原字节SHA一致、只创建1次生成；四图和手机基线通过。最终typecheck退出0；完整单测102文件/851通过1跳过；build、密钥扫描45文件/4值/9标记、audit高危门禁均退出0。
- 浏览器worktree共享依赖junction导致Vite默认fsallow拒绝hydration，使用E盘临时独立配置包含真实node_modules路径完成测试后已清理；未修改产品配置。旧测试的15秒等待不够12轮上传请求，改为等待实际generate请求再断言，未延长生产超时。
- 审查：后端独立审查无遗留P1/P2；客户端发现电脑快10分钟会误判服务器TTL，已先红后绿修复（客户端快1小时回归通过，服务端410为准）。下一步CI、受控升级和真实公网1.37MB/4MiB原图复验；未发真实付费生成。

### [2026-10-28] 截图粘贴提交失败：公网传输诊断，尚未修复
- 生产仍0.3.2/98c3a57，未修改业务或部署。用户约1.37MB请求在北京时间20:19:31/20:26:59触发Web上传读取120秒408，Caddy对应502/断连；失败文案来自上传准备catch，未进入该任务的生成提交。
- 服务端只读采样确认Caddy→Web字节全部ACK、队列0，公网输入停滞；无配置带宽限速、CPU/内存限额或OOM。代理路径与物理socket测试均失败，不能仅归咎Clash或认定具体运营商故障。绑定源IP不等于绕过TUN，固定IP探针仍保留HTTPS证书校验。
- 有意使用随机无效图片隔离传输、避免存媒体或发付费生成：16/64KiB初次约2秒完整到达后400；256KiB/1.37MB30秒未完成。固定IP连续8次64KiB中7次完整到达（1.46–11.66秒）、1次连接重置。400仅证明请求体读完并被格式校验拒绝，不能称为生图通过。
- 验证：Node22环境typecheck退出0；前端定向9文件/39测试通过；工作区没有业务代码改动。脱敏证据在`.cache/logs/deployment/paste-*`与`.cache/logs/upload-diag-server-sockets-window.jsonl`。
- 下一步：已提出原图不变的64KiB分片、幂等创建/完成、受限自动重试方案并独立评审；见`docs/superpowers/specs/2026-10-28-reference-upload-recovery.md`。等待owner选择分片改造或先处理网络线路，尚不能宣称上传已恢复。新建临时探针脚本、随机文件及Cookie将在交接前清理。

### [2026-10-28] 0.3.2生产更新与上传复验完成
- 发布：`98c3a57`快进main并推送；[CI #52](https://github.com/Ttt599536561/image-2/actions/runs/40680383991)全绿，Docker运行依赖及真实空栈smoke通过。预构建后受控upgrade完成，五服务运行、Web/PG healthy，运行时0.3.2/98c3a57、health204。镜像别名`ai-image-workshop:0.3.2-98c3a57`保留。
- 生产验收：同一922428B PNG由旧版连接重置变为新版32KiB/s限速上传44.445674秒、HTTP200；Web记录44064.725ms/200。线上桌面1280×800与手机390×844在参考图请求未返回时均显示“任务已提交”；该UI验收拦截upload/generate，无真实模型调用。服务器内经完整HTTPS上传200/222ms；跨公网不限速探针仍有断连，见已知风险。
- 回退与证据：`deploy/backups/20261028T113359Z`的database/media/manifest校验和全OK；私有配置`deploy/backups/submission-0.3.2-before.env`，旧镜像`ai-image-workshop:rollback-before-submission-20261028`。根目录`.cache/logs/deployment/`保留`submission-*`运行/升级/截图与`upload-timeout-*.json`；完整本地日志归档在`submission-local-verification/`。成功探针上传的图片已按精确key删除。
- 边界：未压缩用户原图、未使用有效Key发生成、未调整付费带宽；这里只修复已确认的15秒上传预算并改善提交反馈。刷新时仅内存参考图无法续传，未送达任务经恢复核对后提示重新选图。

### [2026-10-28] F-079立即显示任务及上传502修复
- 任务来源：owner报告图生图“请求未完成（502）”，要求点击即显示任务已提交、后台上传，并检查是否能提高服务器传图带宽。
- 根因证据：Caddy多次记录约0.9MB的`/api/studio/uploads`在15–17秒断连502；Web对应408约15秒。`readLimitedBody`默认15秒取消Node请求流，引发代理连接关闭。本地同一922428B PNG限速探针旧版连接重置；服务器内部上传200/1240ms。Caddy、Docker和tc均未设置上传带宽限速，没有修改套餐或虚构带宽开关。
- 完成了什么：参考图独立120秒读取预算，JSON仍15秒且大小/同源/归属/限流不变。前端先以固定ID展示任务，后台按冻结的模型、Key及四图顺序上传与入队；失败在原卡重试，已传keys可复用；429保留原请求。Key/files只在内存，历史只存安全准备标记。刷新未确认任务有30秒恢复宽限，服务端确认的deadline内拒绝迟到missing误判；终态和幂等边界保持。
- 验收证据：typecheck退出0；完整单测98文件、792通过/1跳过；build退出0；产物扫描42文件、4项密钥值与9结构标记PASS；audit高危门禁退出0（原有4项开发依赖中危）。独立审查报告的慢上传/刷新/429竞态均已先红后绿修复并复查，无遗留P1/P2。浏览器新两项已验证桌面/390px手机先显示任务与四图失败原卡重试；完整E2E16项通过（1.6m，退出0），上线证据待追加。
- 边界与下一步：独立工作树`.local/upload-timeout-worktree`，独占E盘测试库`image2_submission_test`，端口18931。无真实付费生成；刷新丢失仅内存参考图的未送达任务需重新选图，不能声称浏览器关闭后仍可继续上传。

### [2026-10-28] 0.3.1紧凑双模型四图工作台：生产更新完成
- 任务来源：完成owner本轮六项要求及沿用已授权发布流程。
- 发布：实现 `89a9dcb` 已快进main并推送；[CI #50](https://github.com/Ttt599536561/image-2/actions/runs/40670458359)全绿，97单测文件/774项通过，Docker和真实空栈smoke通过。服务器预构建后执行受控upgrade，0013迁移应用，upgrade.state complete/status0；五服务正常，Web/PG healthy。
- 生产验收：运行时0.3.1/89a9dcb；HTTPS首页200、health204、固定baseUrl、maxReferenceImages=4、缺Key请求400；旧套餐接口404、注册跳回首页。浏览器实际打开两模型菜单，列表可聚焦，固定URL字段readOnly，四图计数可见；截图 `.cache/logs/deployment/refinement-production-desktop.jpg`。没有提交带有效Key的生成请求，也没有读取上游Key。
- 回退与证据：旧镜像 `ai-image-workshop:rollback-0.3.0-f894508` 保留，当前 `ai-image-workshop:0.3.1-89a9dcb`。备份 `deploy/backups/20261028T102051Z` 的database/media/manifest校验和全OK，更新前私有配置 `deploy/backups/studio-0.3.1-before.env`。主目录 `.cache/logs/deployment/refinement-upgrade.log` 和 `refinement-production-verification.json` 保留上线证据；本地及CI完整测试见上一条记录和工作树日志。
- 下一步：工作完成。默认模型保持gpt-image-2，用户可主动选择gpt-image-2.5-sunburst。单张参考图仍4MiB；旧异域保存Key不自动改投固定服务，需重新填写。

### [2026-10-28] F-078紧凑布局、双模型与四参考图：本地验收完成
- 任务来源：owner六项改进要求：缩小结果区、控制台无需内部纵向滚动、两指定模型可选、URL固定、美化质量/背景选择器、全面检查UI交互、支持4张参考图。
- 完成了什么：菜单72px、控制区420–500px，合并合理分组并减少留白；模型/质量/背景统一自定义可访问选择器，4张缩略图按序管理。服务固定api.tangguo.xin/v1，模型仅gpt-image-2.5-sunburst和gpt-image-2，默认2；旧异域保存Key不改投新固定服务。0013新增有约束的引用数组，任务保存模型/全引用快照，worker多图multipart、逐项owner检查、全引用清理保护；单图/旧历史兼容。多图出站限制16MiB＋64KiB，其他请求仍5MiB。
- 验收证据（均退出0）：typecheck；完整unit97文件/773通过1跳过；money20文件/107通过；E2E14通过；build；产物密钥扫描42文件/4配置值/9结构标记PASS；audit高危门禁通过（4个旧开发工具中危项）；真实PG空库认证迁移与管理员角色回归通过。定向safe HTTP还覆盖4张各4MiB真实multipart字节。13张截图检查700/720/768/900/1080双主题，600高度单一页面滚动可达，320/390四图与浮层无横溢出。
- 审查与修复：真实浏览器发现首次打开选择器仍hidden时focus失效，已拆分定位和可见后聚焦；修复后方向键/Enter/Escape/Tab均过。防止旧异域服务的记住Key被自动发到固定服务；仅规范化后同目标才保留，已补单测和E2E。独立复查无未关闭P1/P2。测试合成paste及被浮层遮住的点击定位错误也已修正，未增加延时掩盖问题。
- 边界与下一步：按既有授权推送、构建、备份与部署。未读取/使用真实上游Key、未发付费生成；两模型以用户指定项提供并验证请求协议，账号实际可用性由其上游决定。工作树 `.local/studio-refinement-worktree` 和 `.cache/logs/` 保留验证记录。

### [2026-10-28] 0.3.0匿名工作台生产更新完成
- 任务来源：承接owner已授权的F-077开发、GitHub推送和服务器镜像替换。
- 发布与修复：主实现 `3973aec` 已快进main；首次CI仅空栈媒体探针失败（旧探针未带会话，预期被新版404）。补丁 `f894508` 改为真实创建两个匿名会话、owner路径文件，重建前后均验证owner读原字节/private缓存、另一会话和无会话404；没有放宽产品鉴权。[CI #48](https://github.com/Ttt599536561/image-2/actions/runs/40660966706)全部通过，93单测文件/721项通过，真实空栈smoke完成。
- 生产更新：预先构建新镜像以缩短停机；保留 `ai-image-workshop:rollback-0.2.9-20261028`，受控备份在 `deploy/backups/20261028T090714Z`，database/media/manifest校验和均OK。另有私有配置快照 `deploy/backups/studio-0.3.0-config.env`。只重建Caddy以更新文件挂载与私有媒体代理，再执行installer --upgrade；0012迁移成功，upgrade.state complete/status0，五服务运行，Web/PG healthy。当前镜像标签 `ai-image-workshop:0.3.0-f894508`。
- 公网验收：正式HTTPS `/`200且直接渲染工作台，health204，welcome/login/register/billing跳回首页；旧packages/me/admin config及POSTredeem/generate/signup均404。新session为Secure/HttpOnly/SameSite=Lax；缺Key生成400，没有入队或请求上游；管理员仅运维登录和system-update接口200，测试会话已登出。匿名余额账户/积分批次数均0，待执行任务0。强制新IP的TLS验证结果0；浏览器已打开新版并保存桌面截图。
- 验证记录：主目录 `.cache/logs/deployment/studio-production-verification.json`、`studio-upgrade.log`、`studio-production-desktop.jpg`；开发工作树完整E2E9项、money104项、构建及审查记录保留供复验。新流程仅保留当前浏览器历史（50条/200MiB），服务器图片临时7日；重要作品需用户下载。
- 下一步：本次工作完成；线上未进行真实付费生图测试。现有安装器结尾的system/custom显示是兼容旧版的提示，不能用作公开能力判断；新公开路由只有URL＋Key工作台。

### [2026-10-28] F-077 无账户URL＋Key工作台：本地验收完成
- 任务来源：owner要求去掉普通登录注册、套餐积分和首页海报，改为URL＋Key生图；左侧菜单/参数、右侧大结果区，并明确授权推送GitHub、重建镜像更新现有服务器。owner确认历史保留当前浏览器。
- 完成了什么：E盘工作树 `codex/anonymous-studio` 将首页换为80px菜单＋352px参数＋弹性结果画布，手机可收起面板；真实尺寸卡、提示词、参考图、质量/背景、下载/放大/复用。Key默认页面会话、显式remember才持久化；IndexedDB保存最多50条/200MiB元数据及原图，刷新恢复未完成任务。大图转参考副本保持原图与透明；手机320px操作通过。
- 后端边界：0012新增token-hash匿名会话及共享限流表，业务owner不经注册/不发积分；强制custom、URL＋Key按任务加密冻结、幂等ID、owner10/全局100原子闸、单worker十槽；SSE与图片/上传校验owner。HTTPS出站检查全部DNS答案并固定连接IP，禁止私网/redirect，32MiB输出上限。旧账户/计费/营销路由归档 `legacy/routes` 且不注册；管理员只保留登录/系统更新，认证不发积分、scheduler不再运行计费维护。原表保留供回退。
- 验收证据（均退出0）：typecheck；完整unit `92 passed / 717 passed | 1 skipped`；后续改动定向 `9 files / 41 passed`；money `20 files / 104 passed`；全新匿名E2E `9 passed (46.8s)`；build、assert-no-secrets、audit(high门禁)。Linux隔离部署合同测试与Git Bash真实PG auth迁移/管理员双角色回归通过。原始日志在工作树 `.cache/logs/`。未调用真实生图/付费上游，E2E仅stub relay，真实PG/SSE/媒体链路。
- 审查与修复：独立安全审查覆盖SSRF、cookie/origin、隔离、密钥、并发/幂等和退役入口，P2大图复用问题修复后复查24项通过；真实Chromium将6.32MB PNG转2.91MB WebP，透明像素保留且原图未变。E2E发现320px结果工具栏溢出7px，已自然换行修复并验证下载。初次E2E定位器不匹配辅助文案已修正，没有增加业务超时掩盖问题。
- 边界与下一步：生产仍待更新；版本0.3.0，旧站长Key不参与新工作台。图像服务器临时保留7日，本机缓存独立；旧用户/计费数据未删除。部署前保留DB/env与旧镜像备份，CI通过后更新现网并检验无登录页面/匿名API/旧API404/管理员运维登录。

### [2026-10-28] DNS 切换与公网 HTTPS 验收完成
- 任务来源：owner 已在 DNSPod 将 `one-image2` A 记录改为 `45.207.199.3`，要求继续检查 HTTPS 和网站访问。
- 完成了什么：Cloudflare 与 Google 公共 DNS 均确认新 IP；Caddy 此前因旧解析失败处于600秒退避，重启仅 Caddy 后即成功签发正式 Let's Encrypt 证书，未修改业务服务或数据库。证书 SAN 为 `one-image2.tangguo.xin`，有效期至2027-01-26 14:34:35北京时间，证书链及主机名验证通过。
- 验收证据：本机直连新 IP（curl `--resolve`，未禁用TLS校验）`/healthz`204、`/welcome`200、`/admin/login`200，remote_ip=`45.207.199.3`、ssl_verify_result=0，全部退出0；HTTP308到同域HTTPS。服务器普通DNS访问同样指向新IP且health204。正式HTTPS域名的13项认证/路由检查通过，含匿名后台401、管理员登录200、会话200、页面与配置/更新器/Relay API200、登出200；运行时SHA仍为ca55891。内置浏览器已打开正式首页，截图 `.cache/logs/deployment/public-site-https.png`。
- 限制与本机网络：本机Clash TUN将域名映射到198.18.0.135；正常浏览器/普通curl可访问，强绑物理网卡同时访问fake-IP会超时，不能据此判定网站故障。新IP直连和服务器端普通DNS探测已排除旧站响应混淆。尚未调用真实生图；系统Relay Key仍待owner后台填写。
- 证据与下一步：`.cache/logs/deployment/public-auth-verification.json` 保存正式HTTPS登录验证；本轮公网探测摘要及浏览器截图同目录。部署、解析和HTTPS任务完成，旧腾讯云站点保持原样，管理员凭据继续保存在本机 `.local/deployment/admin-access.json`。

### [2026-10-28] 恢复中断部署：新机安装与管理员验收完成，待 DNS 切换
- 任务来源：owner 要求接续「拉取并启动 image-2 项目」中断聊天；此前已授权推送 GitHub、部署 `45.207.199.3`，明确不保留旧数据，管理员邮箱 `599536561@qq.com`。
- 完成了什么：复核旧断点 `admin_seeded`，保留数据库和管理员；管理员角色校验修复 `6d7bece` 已存在。发现上一轮 Better Auth `1.7.7` 依赖草稿，完成独立审查与复验后提交 `ca55891` 并推送 main，修复新披露公告导致的 high/critical 审计失败；没有业务代码或 schema 改动。新机通过 Git 拉取、构建镜像、`bash deploy/install.sh --resume` 完成安装；安装状态 `complete`，五个服务正常，Web/PG healthy，自动更新 path enabled/active。
- 验收证据：本轮 `npm run typecheck`、`npm run test:run`、`npm run build`、`npm run assert-no-secrets`、`npm audit --audit-level=high` 均退出 0；单测 `76 passed / 584 passed | 1 skipped`，产物扫描145文件通过；认证空库/旧库迁移脚本退出0，独立测试库管理员 API smoke 18项通过。已核对同代码/lock 的既有资金98项、E2E 8通过/1跳过日志。GitHub [CI #44](https://github.com/Ttt599536561/image-2/actions/runs/40648757911) 全绿，包含 Docker 与空栈部署测试。
- 新机证据：运行时 SHA 为 `ca55891faf1d422360d06ace5e1b5f981cb9a0c0`，worker concurrency=10，custom enabled；内部 `/healthz` 204、`/welcome` 和 `/admin/login` 200、匿名后台API401、管理员登录/会话/后台/配置/更新器API均200，验收会话已登出。公网新IP的80端口返回正确HTTPS 308跳转；旧机 `/healthz` 仍204。认证账号重复数为0；升级前数据库快照已留在新机 `deploy/backups/` 并验证归档可读。
- 本地与证据位置：主目录依赖已同步1.7.7，8888服务正常；首次冷编译约41秒，启动后过早10秒探测曾超时，随后页面与健康检查正常，无业务代码修复。复验摘要在 `.local/deployment-worktree/.cache/logs/better-auth-reverification-summary.json`；远程构建与登录验收在 `.cache/logs/deployment/`；本地健康摘要 `.cache/logs/local-health-after-auth-upgrade.json`。临时测试账户/容器/脚本已清理，保留可复用依赖缓存和工作树。
- 边界与下一步：新站管理员凭据仅在本机 `.local/deployment/admin-access.json`，不入Git；系统Relay Key尚未配置，真实生图未验证。运行时安装审计0漏洞；开发工具链仍有4个moderate项，不阻断high门禁，未强制降级drizzle-kit。浏览器自动化因无法可靠识别Chrome网址被工具安全检查停止，已请owner手动修改DNS；等待解析后完成证书与公网验证。

### [2026-10-27] F-076 后端低延迟优化：本地验收完成
- 任务来源：owner 决定继续 GitHub 版本，要求先优化生图后端，再核对快速免费部署服务；目标约十个同时生图任务。
- 完成了什么：独立 E 盘工作树 `codex/backend-performance` 实现持续补位十槽 worker、原子 SKIP LOCKED 抢占、单任务异常隔离、I/O deadline 与不可覆盖存图；PostgreSQL 提交通知、owner-scoped SSE、前端直接合并成功图片并保留轮询恢复；删除重复读取、合并 me 查询、批量排序/分页边界、通知索引、池配置与脱敏时序。新增0010/0011迁移；Compose直接Node worker+init+6分钟退出宽限。保留画质、成功后扣费/FIFO/幂等及custom零扣费。
- 验收证据（均退出码0）：`npm run typecheck`；`npm run test:run` 输出 `Test Files 76 passed (76)` / `Tests 584 passed | 1 skipped (585)`；`npm run test:money` 输出 `Test Files 19 passed (19)` / `Tests 98 passed (98)`；`npm run test:e2e` 输出 `8 passed / 1 skipped`；SSE独立重复10次 `10 passed`；`npm run build`；`npm run assert-no-secrets` 扫描144文件PASS；Compose config通过。部署合同测试在隔离Linux/非root环境执行，updater通过、helper27/installer29/backup9/CI smoke通过；auth空库迁移原脚本经Git Bash运行通过。
- 性能证据：11个固定1秒模拟任务、10槽错峰到达，旧/新排队p95 950ms→0ms、全部完成3000→2050ms；真实PG+本地开发Web+浏览器的10次小图片夹具，从开始提交成功结果到图片元素可见p50 40ms/p95 54ms，状态轮询0、详情重取0。不是上游生图或公网速度；原始日志位于 `.local/performance-worktree/.cache/logs/`。
- 审查与排坑：独立审查发现并修复乐观回滚复活、网络提交失败无法恢复、测试端口不一致；补任务计时器SSR水合回归；排序E2E现在等保存响应再刷新，避免取消持久化请求。免费服务结论按当日官方文档记录，Oracle新Always Free口径为2 OCPU/12GB，而非旧文章4/24。
- 本地集成：实现提交 `cce3c75` 已快进合入主工作目录 main；原接管/对照记录先保存至 Git stash 与 `.cache/integration-backup`，最终文档包含原记录。开发库迁移0010/0011完成，单worker配置10；web/worker/scheduler已重启，healthz204，浏览器登录态及表单交互正常；主目录单独typecheck退出码0。本地PowerShell停止脚本已修正JSON日期解析导致未停止旧进程的问题，旧进程已按PID/路径/启动时间核实并退出。
- 下一步：选定可用云实例后再部署。当前没有真实上游测试/生产发布/远程推送；验证工作树与E盘依赖缓存保留供复验，不移除数据卷。

### [2026-10-27] 桌面 0.1.0 源码对比与独立预览
- 任务来源：owner 要求检查 `C:\Users\Administrator\Desktop\image-2`、与当前版本比较并启动网站。
- 完成了什么：只读检查桌面 `codex/work / deb4ae3`（0.1.0），在 E 盘 `.local/desktop-image-2` 建立含未跟踪文件的独立副本，保留原 C 盘内容；复用桌面现有依赖到 E 盘，启动 `http://localhost:8889/` 并打开。当前 0.2.9 的 8888 服务继续运行；比较记录在副本 `.local/README.md`。
- 验收证据：旧版 `npm run build` 退出码 0；`npm run test:run` 输出 `Test Files 11 passed (11)` / `Tests 65 passed (65)`；8889 首页 200，代理 GET 405；8888 healthz 204。旧版 package/source/lock 无修改。
- 差异与限制：旧版为无账户计费的文生图单页，本地 Vite 同步代理直返图片，默认模型 gpt-image-1-mini；当前版为固定 gpt-image-2 的完整持久任务/资产平台。旧版 npm ci 因 lock 的 @emnapi 依赖不一致失败，使用原已有依赖副本完成验证。没有调用真实 Relay，不能声称同模型出图更快。
- 下一步：owner 对照两版后决定后续改造；后端性能方案仍待确认，未开始产品实现。

### [2026-10-27] 后端性能审计与 10 并发改造方案
- 任务来源：owner 要求全面优化后端与最快出图，并明确高峰约 10 个同时生图任务。
- 完成了什么：并行审计生图/存储/状态链路与数据库读取；确认 worker 批次屏障、默认单并发、异常外溢、终态后二次详情请求、部分存储缺少 deadline、重复查询等问题；完成 `tasks/2026-10-27-backend-performance.md`，保留现有质量和资金规则，暂未改产品实现。
- 验收证据：`npm run typecheck`、`npm run build` 退出码 0；现有开发服务 5 个常用读取 API 各 50 请求/并发 10，非 200 为 0、p95 17.2–35.8ms，原始记录 `.cache/logs/performance-audit-dev-baseline.json`。数据来自本地近空库，不代表生产或上游生成耗时；额外生产模式测量进程启动被自动审批以 `blocked by policy` 拦截。
- 下一步：按项目工作流确认具体改造方案后编写实施计划，依次做调度/执行/结果、通知/读取两批；真实 Relay 并发与流式兼容性需要独立实测。

### [2026-10-27] E 盘本地源码接管与开发环境启动
- 任务来源：owner「拉取源码到本地，熟悉代码，启动并打开，准备下达新需求」。
- 完成了什么：克隆 `main` / `e9f41c6` 至 `E:\iamge2生图项目工作区`；梳理路由、鉴权、生图队列、worker、积分与存储链路；使用项目内 Node 22.23.4 和 npm 缓存。复用 Docker PostgreSQL 17 镜像建立独立 `image2_local` 库，绑定 `127.0.0.1:55432`，迁移 0000–0009 完成；启动 web、worker、scheduler；浏览器已登录本地管理员并打开 `http://localhost:8888/`。
- 验收证据：`npm run typecheck` 退出码 0；`npm run test:run` 输出 `Test Files 61 passed (61)`、`Tests 487 passed | 1 skipped (488)`；本地 `/healthz` 204、`/welcome` 200；浏览器工作台显示管理员、积分和生成表单。
- 本地说明：启动/停止/环境脚本在 Git 本地忽略的 `.local/`，运行说明 `.local/README.md`，账号凭据 `.local/access.txt`；日志与截图在 `.cache/logs/`。数据库卷随 Docker WSL 存在 E 盘；媒体使用 `.local/media`。本次未修改产品逻辑，未访问或部署生产。
- 下一步：等 owner 新需求。真实生图尚未验证，需配置 Relay Key 或在网页提供自己的 Key；新本地库为空业务数据，仅创建了本地管理员。

### [2026-07-26] F-074 挑刺评审关闭：任务队列清空
- 任务来源：owner「不需要评审，我已经评审了，更新文档任务状态为空」
- 完成了什么：任务卡 2026-07-25-sidebar-projects.md 风险区第 2 条
  「验收前安排挑刺评审会话」标注 owner 已自行评审完成、无需另开挑刺
  会话；状态区追加「挑刺评审已由 owner 自行完成，任务全部关闭，无
  待办」；本文件速览「下一步做什么」改为任务队列为空
- 下一步：等 owner 新需求；新会话先按 CLAUDE.md SOP 读本文件 + FEATURES.md

### [2026-07-26] 生产上线 v0.2.9：跨版本受控更新（0.2.7 → 0.2.9）
- 任务来源：owner「部署成功了，更新所有文档状态」
- 完成了什么：
  - owner 已在 /admin/system-update 完成受控更新并确认部署成功；本会话
    实测公网 https://one-image2.tangguo.xin /healthz 204、/welcome 200
  - 本次跨版本直升（0.2.7 → 0.2.9）：v0.2.8 文案两条（资产库 7 天提示 +
    兑换码获取链接）+ F-074/F-075 侧边栏项目分组会话；迁移 0009_projects
    已在维护窗口自动应用，存量会话归档默认项目
  - 全目录文档状态刷新到生产 v0.2.9 基线（commit 407cdea）：CLAUDE.md、
    README、FEATURES、development、redesign-requirements、requirements、
    dev/00–11、deploy、local-acceptance、tasks 等；刻意保留的历史记录
    （首次受控更新修复史、0.2.7 验证记录、旧日志条目）不动
- 下一步：等 owner 新需求；新会话先按 CLAUDE.md SOP 读本文件 + FEATURES.md

### [2026-07-25] 发布 v0.2.9：侧边栏项目分组会话上线更新通道
- 任务来源：owner「发版」
- 完成了什么：package.json + lock 同步 bump 0.2.9；`release:validate
  --tag v0.2.9 --latest-tag v0.2.8` 通过；推送 main（407cdea）+ tag v0.2.9，
  CI 已发布 stable/latest Release v0.2.9（Full Changelog v0.2.8...v0.2.9）
- 下一步：owner 在 /admin/system-update 点更新；本次含 0009_projects 迁移
  （projects 表 + conversations 两列 + 存量会话归档），更新器会在维护窗口
  自动跑迁移，生产升级后存量用户首次进入即完成默认项目归档

### [2026-07-25] F-074/F-075 侧边栏项目分组会话：已验收（0777353）
- 任务来源：owner「开工」（需求卡 tasks/2026-07-25-sidebar-projects.md，
  Q1–Q6 已拍板，Q3=新项目插列表首部）
- 完成了什么：
  - 数据层：`projects` 表 + `conversations.project_id/sort_order`（迁移
    0009_projects.sql，幂等；存量会话一次性归入各自懒创建的默认项目并按
    updated_at 倒序编号）；`uq_projects_user_default` 部分唯一索引做并发幂等键
  - 服务端/契约/路由：loadProjects/createProject（置顶 shift+1）/
    renameProject/reorderProjects/reorderProjectConversations（整组集合一致
    校验，不符 400）；`api.projects(.order/$id/$id.order)` 四端点已注册
  - enqueue：新会话在创建事务内 ensureDefaultProject + sort_order=min-1
    置顶归入；_app loader 与 useProjects 水合首屏
  - 前端：Sidebar 最近区重构为项目区（文件夹图标、点击展开/收起记
    localStorage、hover 出现 …（重命名居中弹窗）与 +（新建居中弹窗））、
    ProjectNameDialog 组件、Pointer Events 长按 350ms 拖动排序（同项目内/
    项目间，跨项目在 UI 层不发生）、乐观更新+回滚全沿用现有模式
  - 排坑两个：① <a> 原生 HTML5 拖拽会劫持真实浏览器长按手势（pointercancel）
    → NavLink draggable={false}；② 菜单外点关闭用 data-project-menu DOM
    归属判断（stopPropagation 对合成/原生混用不可靠）
  - e2e fixture 同步镜像 enqueue 归属逻辑（harness 直插 DB 绕过服务端）
- 验收证据：
  - `npm run typecheck` 绿；`npm run test:run` 61 文件 487 通过 1 跳过
    （新增 projects.server 12 例 + Sidebar 组件 6 例）
  - `npm run db:test:migrate` applied 0009；e2e sidebar-projects.spec
    9 步全过（空态→默认项目→展开收起→二次生成→新建→重命名→会话拖动→
    项目拖动→刷新持久化）；全量 e2e 仅 key-modes 既有本机失败（与基线一致）
- 下一步：等 owner 发版指令（bump + tag 走既有 release 流程）；生产升级后
  存量用户首次进入即完成默认项目迁移
- 注意：移动端长按拖动在部分浏览器可能触发侧栏滚动（touch-action 需手势前
  设置，属已知限制）；任务卡「明确不做」清单不变（无删除项目/无跨项目移动）

### [2026-07-25] 需求文档：侧边栏「项目」分组会话（未开工）
- 任务来源：owner 新需求五条（侧边栏最近对话改为项目分组，参考
  codex 类工具 + 参考图），明确「先写需求文档，不着急开发」
- 完成了什么：
  - 任务卡 `tasks/2026-07-25-sidebar-projects.md`（按 TEMPLATE.md：
    需求细则 R1-R6、涉及文件、明确不做、验收步骤、验收命令、风险、
    6 个待确认问题 Q1-Q6）
  - 参考图存至 `docs/refs/sidebar-projects-reference.png`；tasks/README
    已登记
  - 要点：默认项目懒创建、新会话自动归入、项目内长按拖动排序
    （跨项目回弹）、项目排序、点击展开/收起、hover 出现 `...`（重命名
    弹窗）与 `+`（新建弹窗）；存量会话迁移是最大风险点
- 下一步：Q1–Q6 已全部拍板（Q3 = 新项目插列表首部；其余采纳建议），
  需求收口待开工；开发前需先安排数据结构变更，验收前安排挑刺会话

### [2026-07-25] 发布 v0.2.8：资产库 7 天清理提示 + 兑换码获取入口
- 任务来源：owner 新需求两条（文案/提示），随后「发布更新吧」
- 完成了什么：
  - F-020：/assets 副标题改为「资产库图片仅保存7天，过期自动清理，
    请及时下载保存」（批量管理模式提示语不变）
  - F-032：/billing 兑换码充值卡片标题下新增一行提示「前往
    https://api.tangguo.xin/ 获取兑换码」，链接新标签页打开
  - 按 Git 纪律分两次 feat 提交（4773d81 / 374c8cf），版本号
    package.json + package-lock.json 同步 bump 至 0.2.8
  - `release:validate --tag v0.2.8 --latest-tag v0.2.7` 通过；
    推送 main（4979eb0）+ tag v0.2.8，CI 已发布 stable/latest
    Release v0.2.8（github-actions，Full Changelog v0.2.7...v0.2.8）
- 验收证据：
  - `npm run typecheck` 绿；`npm run test:run` 59 文件 469 通过 1 跳过
  - e2e key-modes 既有失败复现于干净基线（186ad4e），与本次改动无关，
    判定同「已知风险」节（本机 Windows 轮询环境问题）
- 下一步：owner 在 /admin/system-update 检查更新并确认，把生产从
  v0.2.7 升到 v0.2.8（维护窗口数分钟，自动排空+备份+迁移）

### [2026-07-25] 生产上线 v0.2.7：三连根因修复，受控更新首次全链路跑通
- 任务来源：owner「发布上线吧」（接 F-073 会话）
- 完成了什么：
  - 先发 v0.2.3（首页画廊）→ 生产更新卡死 → 连续定位修复三个潜伏
    宿主环境缺陷，最终 v0.2.7 上线成功
  - 根因①：Debian 12 的 jq 1.6 `--stream --slurp` 把流式闭合事件拆成
    第二个 slurp 值 → 更新器重复键校验恒失败 → 任何请求被 set_failure
    静默拒绝，systemd 重启循环 55 次（7-15 起卡 10 天）。修复：改
    `-n --stream` + `inputs` 聚合（ec37aa7 → v0.2.4）；仓库自带更新器
    测试套件在生产 jq 1.6 上实测 PASS
  - 根因②：单元 ProtectSystem=strict 下 /root 只读，docker CLI
    `mkdir /root/.docker` 中止构建 → UPDATE_FAILED 自动回滚。修复：
    更新器导出 `DOCKER_CONFIG=$CONTROL_ROOT/.docker`（5e12bdc → v0.2.5）
  - 根因③：单元 UMask=0077 → git checkout 出 600 root:root 文件 →
    镜像内 USER node 读 package.json、drizzle/*.sql 全 EACCES →
    v0.2.5/v0.2.6 两次 INTERRUPTED_AFTER_MIGRATION。修复：Dockerfile
    运行层 `COPY --chown=node:node --chmod=0644`（ebc13ff → v0.2.6）+
    构建层 `chmod -R a+rX /app`（c18250e → v0.2.7）
  - 两次中断均按预案 `updater recover <REQUEST_ID>`（pg_restore 备份 +
    旧镜像回切），站点分钟级回 v0.2.0，零数据损失
  - 宿主热修复：/usr/local/sbin 更新器换 v0.2.5 tag 精确内容（md5 校验），
    清 7-14 过期请求/预约，initialize（idle/0.2.0）+ .path 重启；
    经认证后台 API（与 UI 同路径）发起更新，审计齐全
- 验收证据：
  - requestId 453794fb-354c-4421-a179-f727faf16d8e：13:06:25 → 13:09:16
    completed，maintenance=false，backupId 20260725T130630Z
  - 迁移 0007_generation_source_image + 0008_landing_gallery 于
    13:09:08 applied，app_migrations 共 9 行
  - 宿主更新器 md5 == `git show v0.2.7`（a4b05426…，自更新生效）；
    生产树 HEAD=db1703f（v0.2.7）
  - 公网 /healthz 204、/welcome 200（含 gallery/灵感内容）；后台
    system-update API：build 0.2.7 / phase completed / enabled；
    /api/admin/landing-gallery 200；audit_log 有 system_update_start 记录
  - v0.2.4/v0.2.5/v0.2.7 三次发布 CI + release job 全绿，均为 stable Latest
- 遗留与清理（2026-07-25 收尾复核）：宿主保留 7 份备份
  （20260712T040301Z/20260712T084145Z/20260713T145807Z/20260725T123528Z/
  20260725T124505Z/20260725T125751Z/20260725T130630Z，恰在保留策略内）
  与 3 份旧更新器脚本（/root/ai-image-workshop-update.pre-v0.2.2.5286434、
  .pre-v0.2.3-recovery.bak、.pre-v0.2.4-hotfix.bak，小文件，安全留存）；
  两个失败构建的悬空镜像与全部构建缓存已 prune（释放约 4.5G，
  :latest=v0.2.7 不受影响）；已合并的旧远程分支
  codex/admin-system-updater 已删除；tasks/ 四张当日任务卡均已验收；
  控制目录无残留请求/预约/checkpoint，web-run 迁移容器为 --rm 已自动清理

### [2026-07-25] 管理后台手动配置未登录首页画廊（F-073）
- 任务来源：owner 口头需求"管理后台要能手动配置用户端未登录时看到的首页
  展示的图片"（tasks/2026-07-25-admin-landing-gallery.md）
- 完成了什么：
  - 新表 `landing_gallery_items`（迁移 0008 + schema.ts），与灵感库解耦
  - 契约 LandingGalleryAction（zod）+ 上传响应；server CRUD/排序/审计
    （src/server/admin/landing-gallery.server.ts）
  - API：/api/admin/landing-gallery（GET/POST）+ /upload（multipart 魔数嗅探）
  - 后台页 /admin/landing-gallery + 侧边导航「首页画廊」（沿用灵感库交互）
  - r2.server 新增 landing/ 前缀 putLandingImage；🔴 高危点：
    maintenance 孤儿清理 known-set UNION landing_gallery_items.image_key
    （否则在用门面图超 1h 被误删）
  - reads.server 新增 loadLandingGallery()（空/异常 → null 回退）；
    welcome loader 优先读配置（全量上架卡），未配置回退灵感库 slice(14)
  - 新增测试 14 条：孤儿保护 2、读路径 5、welcome 回退链 3、后台页组件 4
- 验收证据：
  - `npm run typecheck` → 退出码 0
  - `npm run test:run` → 59 文件 469 通过/1 跳过（含新增 14 条）全绿
  - `npm run db:test:migrate` → applied 0008_landing_gallery.sql
  - `npm run test:e2e` → key-modes 同一断言连续失败；**基线对照实验**
    （stash 全部改动后在 494e819 跑）同样失败 → 本机既有轮询环境问题，
    非本次缺陷（详见状态速览）
  - `npm run build` → 成功；`npm audit --audit-level=high` → 0 high
  - 浏览器实操（Playwright 真实点击，脚本用后已删）：管理员登录 →
    首页画廊空态 → 新增「山间晨雾」（贴 data URL）→ 列表可见上架 →
    未登录 /welcome 展示该图 → 后台下架 → /welcome 回退灵感库（图消失）。
    截图 4 张存 ../shots/f073-*.png
- 提交记录：见 git log "feat: [F-073]" / "docs: [F-073]"
- 环境变更：本机 `.env` dev 库与一次性测试库分离（5433/ai_image_dev ↔
  5433/ai_image_test；此前同库触发 test-env-guard 拒绝），dev 库已迁移
  0000-0008，本地 `npm run dev` 可用
- 遗留问题：e2e key-modes 本机高频失败（基线同败，环境问题）；生产上线
  前需在 CI/Linux 环境复跑 e2e
- 下一步建议：随下次发布上线后，管理员即可在 /admin/landing-gallery
  配置门面图；可评估「从灵感库一键选入」增强

### [2026-07-25] 修复 CI 依赖审计失败（3 个 high 漏洞）
- 任务来源：owner 收到 GitHub CI 失败通知（tasks/2026-07-25-ci-audit-fix.md）
- 根因：GitHub CVE 库新披露 advisory 命中已锁定版本（react-router 8.0.1
  RSC CSRF、better-auth 1.6.20 magic-link 劫持、postcss 路径遍历），非
  本次代码引入；本次 push 触发 CI 暴露了它。教训：push main 前必须本地
  跑 VERIFY.md 第四节（build/audit），push 后必须盯 CI 状态——已补记纪律。
- 完成了什么：react-router 四件套 8.0.1→8.3.0、better-auth 1.6.20→1.6.25、
  postcss→8.5.23（npm audit fix）；攻击面评估：两漏洞均不适用本项目
  （不用 RSC Mode、未启用 magicLink/emailOTP），但门禁必须绿
- 验收证据：本地 `npm audit --audit-level=high` 退出码 0；typecheck 0；
  test:run 55 文件 455 过/1 跳过；build 成功；dev 冒烟 / →302 /welcome、
  /login 200、/welcome 200；push 后盯 CI（bd98d00）至 success
- 提交记录：bd98d00
- 遗留问题：4 个 moderate（esbuild 经 drizzle-kit、valibot）修复需破坏性
  升级，不动；npm 对钉死精确版本的 RR 包有 ERESOLVE 死结，解法为
  `--legacy-peer-deps` 显式升级后普通 install 自洽（已验证）
- 下一步建议：无；CI 纪律见 VERIFY.md 可补充"push 后盯 CI"一条

### [2026-07-25] 方案 B 落地：根路径即门面（F-072）
- 任务来源：owner 拍板"做了吧"（tasks/2026-07-25-root-landing.md）
- 完成了什么：
  - `_app.tsx` 父 loader：未登录访问根路径 / → 302 /welcome（其余受保护
    页 /assets 等照旧 302 /login?next=，已验证未误伤）
  - `welcome.tsx` loader：已登录访问 /welcome → 302 回 /（闭环，无循环）
  - welcome 页 title 改为「one-image2 · 一句话生成你想要的画面」
  - FEATURES.md 新增 F-072 并 ✅；任务卡标记已验收
- 验收证据：typecheck 退出码 0；test:run 55 文件 455 过/1 跳过；
  curl 双向跳转实测 + Playwright 截图（/ → /welcome 200 完整渲染）
- 提交记录：<见 git log "feat: [F-072]">
- 遗留问题：无。已知取舍：URL 显示 /welcome（302），非根域名 200 直渲
  染——换来零路由结构改动；owner 日后在意 URL 可再做直渲染版
- 下一步建议：下次发布上线后，访客打开 one-image2.tangguo.xin 即见
  落地页

### [2026-07-25] 画廊改紧密照片墙：去白框 + 12px 缝隙 + LPT 均衡分列
- 任务来源：owner 反馈"图片之间大量留白、感觉割裂"（附截图圈出列底空洞）
- 完成了什么：
  - 卡片去白底/边框/装裱边/常驻标题栏，图片铺满整卡，整面墙由画面构成
  - 标题+分类标签并入 hover 浮现层（黑渐变底，标题 14px 加粗白字）
  - 缝隙 space-5(20px) → space-3(12px)
  - 弃用 CSS `columns` 自动分列（高图堆同列、邻列底部空出一大块），改为
    `distributeToColumns()`：按宽高比降序后逐张放入当前最矮列（LPT 装箱），
    列数由 `useGalleryColumns()` 按视口宽度 2/3/4/5 自适应（SSR 默认 5）
  - 画墙 padding space-8 → space-6，作品区域更大
- 验收证据：`npm run typecheck` 退出码 0；`npm run test:run` 55 文件
  455 过/1 跳过；Playwright 截图 3 张（2560 宽屏/hover 浮现/1280 窄屏 4 列），
  列尾差 ≈ 自然 Pinterest 尾差，无整列空洞（脚本用后已删）
- 提交记录：c14beba
- 遗留问题：无（真实作品数量多于种子 10 张时尾差会更不明显）
- 下一步建议：刷新 /welcome 验收；后续可考虑方案 B（根域名指向落地页）

### [2026-07-25] 画廊融入感改版：占位图暖调重绘 + 装裱卡 + 衬底画墙
- 任务来源：owner 反馈画廊"没有融入感，图片不像跟网站一体"（附截图）
- 完成了什么：
  - src/lib/placeholder.ts 重绘：荧光绿/亮紫高饱和平涂 → 与网站同源的暖调
    低饱和渐变（陶土/沙金/橄榄/灰蓝/暖褐五色系）+ 颗粒纹理 + 白色内框线
  - 画廊 section 加 `--bg-subtle` 米灰衬底"画墙"（圆角、左右 padding）
  - 每张图卡加白色装裱边（cardImgWrap margin），卡片间距 space-4→5
- 验收证据：`npm run typecheck` 退出码 0；`npm run test:run` 55 文件
  455 过/1 跳过全绿；2560px 宽屏 Playwright 截图确认观感（脚本用后已删）
- 提交记录：2c10b00
- 遗留问题：无（上线后真实 AI 作品照片天然更和谐，无需再调）
- 下一步建议：刷新 /welcome 验收观感；后续可考虑方案 B（根域名指向落地页）

<!-- 模板：
### [YYYY-MM-DD] <会话主题>
- 任务来源：tasks/<对应任务卡> 或口头需求
- 完成了什么：<逐条列，对应 FEATURES.md 编号>
- 验收证据：<贴了哪些命令、退出码、截图说明>
- 提交记录：<git commit 短哈希列表>
- 遗留问题：<没有就写"无">
- 下一步建议：<一句话>
-->

### [2026-07-25] /welcome 落地页重构（品牌+叙事+动效）与主题切换
- 任务来源：owner 反馈"图片硬怼、缺乏高级优雅的连贯体验"+ 增加 image-2
  品牌露出 + 默认浅色/可切深色
- 完成了什么：
  - 品牌：导航与页脚改为 one-image2，Hero 徽章"由 image-2 模型驱动"
  - Hero 重构：左文案右叠层浮动画卡（陶土光晕+浮动动画）+ 提示词打字机
  - 新增"看见魔法发生"演示卡：对话气泡 → 出图 → 二次编辑 → 新图
  - 画廊升级：画框式排布，hover 图片微放大并浮现该图提示词
  - 动效系统：Reveal 滚动浮现（IntersectionObserver，尊重
    prefers-reduced-motion）、毛玻璃吸顶导航、按钮/卡片 hover 微交互
  - 主题：落地页导航加明暗切换按钮（复用全站 cookie 机制，默认浅色
    为原有行为，用户此前见深色系浏览器 cookie 残留）
  - 测试基建：setup.ts 补 matchMedia/IntersectionObserver stub
- 验收证据：
  - `npm run typecheck` 退出码 0；`npm run test:run` 455 通过/1 跳过
  - 浏览器截图验收：浅色默认/点切换后深色/390px 手机版/逐屏滚动五屏
    （y=0/750/1500/2250/3000）各版块均正确浮现与布局
- 提交记录：见本次提交
- 遗留问题：画廊与演示卡当前显示种子占位图（本地库无真实作品），
  生产库有真实灵感卡后自动替换
- 下一步建议：部署上线后可做方案 B（根域名指向落地页）

### [2026-07-25] 注册页文案修复 + /welcome 公开落地页
- 任务来源：owner 两点需求（tasks/2026-07-25-landing-page.md）
- 完成了什么：
  - [F-001] 去掉注册页固定"注册即送 0.14 积分"文案（AuthForm.tsx）
  - [F-070] 新增公开落地页 /welcome：Hero/真实作品画廊/三大能力/三步上手/
    特色条/底部 CTA 六版块，数据复用 loadInspirations()（表空自动回退种子），
    无需登录；新增组件测试 2 条
- 验收证据：
  - `npm run typecheck` → 退出码 0
  - `vitest run src/components/landing src/components/auth` → 2 文件 3 用例全过
  - Playwright 截图验收：1440px 与 390px 两种宽度全页截图，布局与响应式正常
    （本地画廊显示种子占位卡为预期回退，生产库有真实作品即显示真实封面）
- 提交记录：见本次提交
- 遗留问题：
  1. 落地页尚未部署到生产（下次发布时随版本上线）
  2. 线上启用后建议把根域名 `/` 的未登录访问导向 /welcome（方案 B，未做）
- 下一步建议：部署后可让挑刺会话审一遍落地页的 SEO/加载性能

### [2026-07-25] 补跑资金与端到端验收（红灯转绿）
- 任务来源：基线验收遗留的两盏红灯（owner 装好 Docker Desktop 后补跑）
- 完成了什么：
  - 启用 WSL + 虚拟机平台功能，Docker Desktop 正常运行（server 29.6.2）
  - 起一次性测试库容器 `ai-image-test-db`（postgres:17，端口 5433）
  - 配好 `.env.test`（7 个变量，含 `DATABASE_DRIVER=pg` 和
    `DISPOSABLE_TEST_DB_DRIVER=pg` 两个易漏开关，缺它们会去连云服务）
  - `npm run db:test:migrate` → 8 份迁移全部应用 🟢
  - `npm run test:money` → **17 文件 84 用例全绿** 🟢（扣费/FIFO/负余额/
    幂等/custom 零扣费/凭据销毁/不回退 全部真库验证通过）
  - `npm run test:e2e` → 3 轮运行均为"1-2 通过 + 1 偶发超时"：key-modes
    用例依赖浏览器轮询节奏，在本机 Windows dev 服务器下不稳定，失败点在
    轮次间漂移，非确定性产品缺陷（对应业务逻辑已被 money 真库套件覆盖）
- 验收证据：上述命令输出已逐条核对
- 提交记录：本条目随文档更新一并提交
- 遗留问题：
  1. e2e 轮询偶发超时——判定规则已写入 VERIFY.md（重跑确认；同一断言
     连续三次失败才按缺陷处理）；如需彻底稳定，建议后续在 CI/Linux 跑 e2e
  2. Node 24 vs engines 要求 22 的警告仍在
  3. 测试容器 `ai-image-test-db` 常驻本机 Docker，关机后需 `docker start
     ai-image-test-db` 恢复
- 下一步建议：环境验收全部收口，可进入第一个功能优化任务（走 tasks/
  任务卡流程）

### [2026-07-24] 基线验收会话（体检）
- 任务来源：owner 要求执行基线验收
- 完成了什么：
  - 环境：Node v24.15.0（注意：package.json engines 要求 >=22 <23，实测可跑，未阻塞；建议后续装 Node 22 对齐）；`npm install` 378 包成功
  - `npm run typecheck` → 退出码 0 🟢
  - `npm run test:run` → 54 个测试文件、453 通过 / 1 跳过，0 失败，退出码 0 🟢（覆盖登录表单、对话编辑、管理后台、系统更新等）
  - `npm run test:money` → 🔴 未能执行：17 个文件全部因"缺少 .env.test（一次性 PostgreSQL 测试库）"在加载阶段失败，0 条用例实际运行；本机无 Docker/PostgreSQL
- 验收证据：上述命令输出已核对，money 套件失败为环境前置缺失而非代码缺陷
- 提交记录：本条目随文档修正一并提交
- 遗留问题：
  1. 资金链路（F-031/F-033 等）本地无法复验，需在有数据库的环境（CI/服务器）补跑 `test:money`
  2. e2e（`test:e2e`）同样依赖数据库环境，本轮未跑
  3. Node 版本与 engines 声明不一致，仅是警告但建议对齐
- 下一步建议：在服务器或装好 Docker 后补跑 money + e2e 两盏红灯；之后进入正常功能迭代循环

### [2026-07-24] 协作文档框架接管
- 任务来源：owner 要求建立 AI 协作文档框架
- 完成了什么：新建 FEATURES.md / VERIFY.md / WORKFLOW.md / tasks 模板；CLAUDE.md 增补 SOP、验收命令、Git 纪律三节；本文件改造为固定交接格式
- 验收证据：文档类改动，无需跑测试
- 提交记录：待提交
- 遗留问题：FEATURES.md 各条目状态基于历史文档盘点，首次实际跑验收时需逐条复核
- 下一步建议：开一个"基线验收会话"，跑通 VERIFY.md 全部绿灯命令

---

## 历史基线记录（2026-07-14 及以前，格式从旧，仅作存档）

# 当前状态

更新：2026-07-14。生产基线仍为 `0.2.0`；`v0.2.1` 已发布但首次后台更新暴露宿主机请求校验缺陷，尚未进入备份或迁移。`v0.2.2` 修复候选已完成实现，等待最终门禁、发布和一次性宿主更新器恢复。

| 里程碑 | 状态 | 证据 |
|---|---|---|
| 对话式生图与资产 | 已实现 | 登录会话、历史、资产库、灵感库和本地持久化媒体 |
| 积分与后台运营 | 已实现 | 成功后扣费、FIFO 批次、兑换码、套餐、审计和管理后台 |
| system/custom Key 模式 | 已实现 | 统一任务状态机；custom 每任务加密且本站零扣费 |
| 对话结果图文字二次编辑 | `v0.2.1` 已发布（待部署） | 当前对话成功卡入口、Composer 编辑态、来源关系、worker storage 回读和原有计费规则 |
| 单机全自托管 | 已部署 | Debian Docker Compose、PostgreSQL 17、本地媒体和持久卷 |
| 安装、备份与恢复 | 已实现 | 三项可见输入、内部密钥自动生成、校验和与七份普通备份保留 |
| 部署 CI | 已实现 | 脚本契约、构建元数据、空栈安装和持久化 smoke |
| 管理后台稳定版更新 | `v0.2.2` 修复待发布 | 检查/启动页面、隔离控制目录、systemd 更新器、恢复边界、真实请求校验回归和 Release CI |
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

## 2026-07-14 `v0.2.1` 发布（生产待更新）

- 版本：`0.2.1` / tag `v0.2.1`；发布工作流验证通过后成为 stable/latest Release。
- 计划提交：`02b9ca5`
- 契约/迁移：`9cd2c26`
- 入队权限：`da348af`
- worker/storage/计费：`e502196`
- 会话与状态来源摘要：`7021ce4`
- 乐观提交来源：`c7e12a4`
- Composer 编辑态与结果来源 UI：`627c8c9`
- 审查修复（跨会话草稿、来源错误卡、并发删除锁序）：`8ba1dd6`
- 完整聚焦门禁：单元/UI 11 文件 77 用例、真库 6 文件 41 用例全通过；typecheck、生产 build、秘密扫描退出 0。
- 审查后定向回归：前端/Hook 2 文件 9 用例、完整 enqueue 文件 13 用例全通过；typecheck 再次退出 0。
- 范围边界：没有新增生成端点、队列、编辑服务或价格；没有资产库/灵感库入口、画笔、蒙版、扩图或独立编辑器。
- 部署边界：`v0.2.1` 发布不等于生产更新；线上仍是下方“当前生产验证”记录的 `0.2.0` / `c5131aa`，由管理员后台确认后执行更新。

## 2026-07-14 `v0.2.2` 更新器校验热修复（发布候选）

- 生产请求 `26e972ea-37e0-4361-8d03-52130c1c241b` 在 `202` 后始终停留于公开 `idle`；systemd service 每 20 秒退出重试，但站点保持 `0.2.0` 健康。
- 请求与预约 JSON、UUID、时间、权限和单链接均合法；首次失败发生时预约仍有 15 分钟有效期，且没有进入备份、Git checkout、迁移或停站。
- 根因：宿主脚本使用 `jq --stream -e` 逐事件统计顶层键，数组长度永远不能达到 4，导致所有合法请求在发布 `claiming` 前被拒绝。
- 修复：请求与预约校验使用 slurp 聚合全部流事件，同时保留重复键和严格 schema 拒绝；新增真实 `process-request` Shell 回归并纳入 `test:deploy`。
- 后台：浏览器已有 `202` 请求 ID 而宿主仍为 `idle` 时，明确显示“更新请求已提交，等待主机更新器接收”，不再只禁用按钮而无状态。
- TDD 证据：Shell 回归修复前失败于“合法请求未发布状态”、修复后通过；后台 UI 修复前找不到等待状态、修复后 1/1 通过。
- 生产边界：发布 `v0.2.2` 后只引导安装经 tag 校验的宿主更新器入口，清理精确匹配的过期请求，再从管理员后台重新启动原有守护更新流程。

## 2026-07-13 部署证据

- 升级前备份：`deploy/backups/20260713T145807Z`
- 备份校验：`database.dump`、`media.tar.gz`、`manifest.env` 全部通过 SHA-256 校验
- 容器：`postgres`、`web`、`worker`、`scheduler` 均运行；Web 与 PostgreSQL 为 healthy
- 健康检查：`http://127.0.0.1:18080/healthz` 和公开 `/healthz` 均返回 `204`
- 版本固化：Web 容器内 `APP_VERSION=0.2.0`，`APP_COMMIT_SHA` 与生产提交一致
- 后台入口：未登录访问 `/admin/system-update` 返回 `302` 到登录流程
- 更新器：`ai-image-workshop-update.path` 为 enabled/active，`ai-image-workshop-update.service` 为 enabled
- 工作树：生产仓库无未提交修改

## 发布与部署边界

`v0.2.1` tag 指向 `main` 中的精确发布提交。`v0.2.2` 也必须在 CI 验证版本、tag、提交归属、完整质量门和 Docker 空栈 smoke 后，才创建新的 stable/latest GitHub Release。后台更新器只接受严格递增的稳定版，不读取功能分支。

`v0.2.2` 发布完成后生产仍保持 `0.2.0`，直到一次性恢复宿主更新器并由管理员在 `/admin/system-update` 重新启动更新。更新器会先排空任务、备份，再构建、应用兼容迁移并健康检查；该生产结果必须在更新完成后另行记录。

## 持续运维与发布动作

以下是需要按发布或运维周期执行的动作，不代表产品功能未实现：

- 完成 `v0.2.2` 宿主更新器一次性恢复，在管理员后台执行 `0.2.0 -> 0.2.2`，并记录备份 ID、提交、容器和健康检查证据。
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
