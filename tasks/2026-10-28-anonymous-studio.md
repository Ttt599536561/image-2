# F-077：无需登录的 URL＋Key 生图工作台

## 目标与已确认要求

用户于2026-10-28明确要求开发、验收、推送GitHub、重建镜像并更新现有服务器。去掉普通用户登录注册、套餐积分及营销海报；首页即左侧菜单、参数面板、右侧大结果区。用户确认生成历史保留在当前浏览器，刷新可恢复、不同设备不互通，并可清空。现有生产主机/域名保持不变，更新其应用镜像。

## 设计

- 桌面三列：80px菜单、352px参数、剩余宽度结果画布；较小桌面64/320；移动端顶栏、结果与可展开创作面板。菜单为创作/此设备历史/连接设置，主题切换；无套餐、积分、登录和海报。
- URL与Key属于用户自己的OpenAI兼容图片服务，默认URL为https://api.tangguo.xin/v1，模型gpt-image-2。默认Key仅当前会话，只有明确勾选“记住”才存本机；历史永不记录Key。
- 提示词、参考图上传/拖入、比例与真实像素尺寸、质量、折叠背景选项。仅使用现有六种size，不把quality冒充像素分辨率。Ctrl/Cmd+Enter生成，普通Enter换行，中文输入法不误触。
- 结果区大图contain展示、真实排队/生成状态与耗时、下载原图、放大查看、复用参数、以结果作参考图。无虚假百分比、无自动重试上游付费调用。
- IndexedDB保存历史元数据及成功图片Blob，默认最多50条/200MiB，超额淘汰最旧完成记录；存储失败明确提示且当前结果仍可下载。刷新恢复未完成任务状态。清空历史和清除Key分离。
- 采用匿名浏览器会话复用持久队列，session cookie为随机token、服务端仅存hash与owner映射；不通过BetterAuth注册，不发积分、不建余额账户。所有公开生图强制custom，保留十槽worker。匿名所有权覆盖任务、SSE、上传、图片；不接受客户端ownerId。
- URL和Key按任务加密冻结，终态销毁；HTTPS出站校验全部DNS答案并固定连接IP，禁止重定向与非公网目标，图片下载同样保护且不转发Key。读写均有体积/deadline/匿名owner与IP限流。
- 旧普通账户、兑换、套餐/积分API停用，旧页面跳到工作台；保留管理员登录及系统更新运维入口，管理员认证不再补发积分，定时器停止计费维护。旧数据库表不做破坏性删除。

## API约定

- GET /api/studio/session：创建/恢复匿名cookie，返回StudioSessionInfo。
- POST /api/studio/generate：StudioGenerateRequest，返回202 StudioAccepted；generationId为客户端UUID，网络重试同ID不会重复下单。
- GET /api/studio/status?ids=id1,id2：StudioStatusBatch，严格owner范围；不返回积分或Key。
- GET /api/studio/events?ids=id1,id2：SSE event=status，数据为StudioStatusBatch，前端保留轮询恢复。
- POST /api/studio/uploads：multipart file，上限现有4MiB、PNG/JPEG/WebP魔数校验，返回inputImageKey。
- GET /api/studio/images/:id：owner校验后原图，private缓存；状态image.url指向此接口。

## 文件与分工

1. 安全出站与凭据：src/server/studio/safe-http.server.ts、relay.ts、r2.server.ts、generation/credential.server.ts、generation/process.ts及对应测试。
2. 匿名服务：drizzle/0012_studio_sessions.sql、src/server/studio/session.server.ts与请求处理器、app/routes/api.studio.*、generation/enqueue.ts、finalizeCustom.server.ts及对应测试。
3. 新界面：src/components/studio/*、src/lib/studio/*、app/routes/studio.tsx及组件/存储测试。
4. 集成：app/routes.ts、媒体访问、Caddy代理、管理员限定路由/菜单、auth-hooks、scheduler、E2E及部署文档。

## 验收

无cookie直接进入工作台；填URL+Key生成夹具图片；参考图、刷新恢复、下载、放大、参数复用、历史清空和移动布局可用。独立浏览器不能读彼此任务/上传/媒体；伪造system请求被拒；无新增积分/账本；私网DNS/重绑定/重定向/恶意图片URL/超大响应被拒；凭据不进入响应日志或浏览器历史。真实上游不自动调用，除非用户给出测试Key及调用指令。

运行typecheck、完整unit、money、更新后的匿名studio E2E、build、assert-no-secrets、audit、部署合同与Docker smoke；独立审查；通过后提交main、CI全绿、新机备份、迁移与重建更新、HTTPS无登录工作台验收。版本计划0.3.0，不额外迁移域名。

## 状态

已验收并部署（2026-10-28），生产0.3.0/f894508。GitHub CI721单测、money104、匿名E2E9通过；独立审查P2和320px工具栏溢出已修复。真实空栈部署探针、正式HTTPS匿名页面、私有会话、退役接口及管理员运维登录通过。真实上游未调用。详细证据和回退备份见docs/PROGRESS.md。
