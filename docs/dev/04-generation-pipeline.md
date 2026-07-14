# 生图管线

状态：`0.2.0` Docker worker 基线路径已经实现并部署，通过单元测试与空数据 Compose smoke。本文新增的对话结果图编辑管线随 `v0.2.1` stable Release 发布并完成本地验证，等待生产更新；真实 Relay 生图仍作为生产周期性检查执行。

## 提交与状态

`POST /api/generate` 是 system/custom 和对话结果编辑的唯一入口。它完成鉴权、会话和参考图归属校验、请求契约校验，并在事务中写入 `generations(status='queued')`。

- system：检查余额、system 并发和日预算；成功存储后按 FIFO 扣费。
- custom：跳过本站余额、账本、预算和 system 并发，且与 generation 同事务写入 AES-GCM 任务级凭据。
- 两种模式都返回 `202 { generationId, conversationId, status, credentialMode, deadlineAt }`，由浏览器通过 `GET /api/generate-status` 批量轮询。

`generations` 是唯一 job 状态源：`queued -> claimed -> running -> succeeded|failed`。任何状态更新都必须带中间态谓词，防止成功、失败和超时互相覆盖。

对话结果编辑只提交 `sourceImageId`。入队事务要求来源图片属于当前用户、来源 generation 已成功且与目标 conversation 相同；`sourceImageId` 与临时 `inputImageKey` 互斥。事务先无锁校验来源以保证伪造/越权请求在钱闸前拒绝，钱闸后先更新并锁住既有 conversation，再以行锁复核来源；该 `conversation -> generation/image` 锁序与级联删除一致，删除竞态稳定返回来源不可用而不是死锁。通过后仅把 ID 写入 `generations.source_image_id`，不写 URL 或 storage key。

## Docker Worker

`worker` 每 500ms 扫描未过期 queued 行，按 `WORKER_CONCURRENCY`（首次为 1）调用 `runGenerationJob`。实际执行开始时由 `claim()` 原子抢占，因此多个 worker 看到同一行也不会重复下单或扣费。

执行顺序：抢占并标记 running；解析 system 配置或只解密当前 custom generation 的凭据；在 `deadline_at - 30s` 前调用 relay；写入稳定对象；system 执行幂等 FIFO debit、custom 执行零扣费 finalization；任何终态都删除 custom 凭据并写脱敏状态。

若 generation 带 `source_image_id`，worker 在预算调用计数和 relay 前按 generation user 重新查询来源 image/succeeded generation，从服务端 storage adapter 读取字节，再复用 `callRelay(inputImage)` 的 `/images/edits` multipart 管线。来源行已删或对象不可读时写 `failed/source_image_unavailable`，不调用 relay、不生成 child image，也不进入 system debit。原图记录和对象不被编辑任务修改。

Docker 主路径不调用 `triggerBackground()`。该 helper 和 `netlify/functions` 源码仍因迁移兼容而存在，且当前会被路由和 scheduler 导入，所以仍是镜像源码依赖；它们不依赖 Netlify 托管平台，未完成 handler 抽取前不能删除。

## Deadline 与清理

`deadline_at = created_at + 5 minutes` 是权威时钟。状态读取和 scheduler 都可原子将过期 `queued/claimed/running` 收为 `failed/provider_timeout`。终态不扣本站积分。

Scheduler 每分钟 timeout rescan，每 5 分钟清理过期 custom 凭据。凭据的数据库 TTL 是 10 分钟；正常调度下最迟创建后 15 分钟物理删除。失败必须可观测，不能静默吞掉。

## 安全与错误

- relay 固定为服务端配置；客户端不能覆盖 Base URL。
- custom 明文只允许在浏览器 localStorage 和 HTTPS 提交请求中出现；服务端普通表、events、audit、日志、Sentry 和 API 响应均不可出现。
- `callRelay` 统一构造请求、超时、响应解析与 Key 脱敏。custom 失败不可自动回退 system。
- 存储失败、来源不可用、relay 错误、非法 Key、配额、限流、内容拒绝和超时使用稳定错误码；失败不扣本站积分。

## 验证

本地覆盖：契约、enqueue、pipeline、deadline、custom finalization、凭据清理和状态批量读取。发布前按 [deploy.md](deploy.md) 验证 system 仅一次 debit、custom 零 debit、终态删凭据、稳定对象 URL 和脱敏日志。
