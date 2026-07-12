# 7 · 媒体存储

自托管生产默认使用本地持久化媒体卷。`src/server/r2.server.ts` 和 `putToR2` 是历史兼容命名，实际会按驱动选择本地文件系统或 S3 兼容存储。

## 7.1 驱动

| 驱动 | 配置 | URL |
|---|---|---|
| 本地，生产默认 | `STORAGE_DRIVER=local`、`LOCAL_STORAGE_ROOT=/app/data/media` | 同源相对地址 `/media/<key>` |
| S3 兼容，可选 | `STORAGE_S3_*`、`STORAGE_BUCKET`、`STORAGE_PUBLIC_BASE_URL` | 外部稳定公开地址 |

Compose 的 `media_data` 命名卷挂载到 `/app/data/media`，由 web、worker、scheduler 共享；Caddy 只读挂载。重建应用容器不会删除媒体。S3 兼容适配器可连接 Supabase、R2、S3 等服务，但不是单机部署依赖。

本地模式支持写、读、列举、单删和批量删除，并拒绝 `..`、空路径段、反斜杠逃逸和符号链接穿越。

## 7.2 key 与 URL

媒体 key 由服务端生成，包含用户、日期、generation ID 和随机段，例如：

```text
<userId>/2026/07/<generationId>-<random>.png
```

- `images.storage_key` 只给服务端写入、删除和清理使用。
- `images.public_url` 在本地模式保存 `/media/<逐段 URL 编码的 key>`。
- key 不可变，因此 `/media/*` 返回 `Cache-Control: public, max-age=31536000, immutable`。
- 相对 URL 不绑定域名或宿主机端口，切换反向代理后历史图片仍可访问。

内置 Caddy 直接读取只读媒体卷；现有代理模式由 Web 的 `/media/*` 资源路由读取。两条路径使用同一 URL 契约。

## 7.3 落图顺序

Relay 可能返回临时 URL 或 base64。Worker 必须立即取出字节并调用存储适配器，禁止把 Relay 临时 URL/base64 写入数据库或返回前端。

固定顺序：

1. 在数据库事务外写入媒体对象。
2. 开启成功事务，写 `images` 并完成 system 扣费或 custom 零扣费终态。
3. 若事务回滚，已写对象成为孤儿，由 scheduler 在保护窗口后清理。

`images.generation_id` 唯一约束保证重试只产生一条有效图片记录。

## 7.4 保留期

- 免费用户默认保留 7 天，曾兑换用户默认保留 60 天；具体天数来自 `app_config`。
- 首次兑换在同一事务内把现有图片顺延到至少 60 天，只延不缩。
- 临近过期通知使用 `dedupe_key` 幂等写入，重复 scheduler 扫描不会重复通知。

## 7.5 清理

过期清理先确认付费顺延，再删除媒体对象，最后删除数据库 `images` 行并写事件。对象删除失败时保留数据库行，供下次重试。

孤儿清理至少保留 1 小时保护窗口，避免误删刚写入但事务未提交的对象。known-set 必须包括：

- `images.storage_key`
- `inspirations.cover_key`
- 待审核 `inspiration_submissions.image_key`

本地和 S3 驱动都遵守相同清理语义。

## 7.6 前端读取红线

前端所有图片面只读取数据库中的 `public_url`：对话结果、当前会话图片、资产库、灵感库和后台记录都不能自行拼 key，也不能使用 Relay 临时响应。

## 7.7 安全与备份

- 对象 key、metadata 和日志不得包含 system/custom Key 或加密主密钥。
- S3 凭据只能存在于服务端环境；客户端构建秘密扫描必须通过。
- `deploy/backup.sh` 同时归档 PostgreSQL 与整个 `media_data`，并生成严格校验和。
- `deploy/restore.sh` 只向停止且为空的卷恢复，避免合并两套媒体树。

## 7.8 custom 模式

system/custom 使用同一个存储适配器、key 规则、`images` 表、会话历史、资产库和保留期。custom 零本站扣费不等于图片不落盘；任务凭据只存在数据库临时密文表，不得写入媒体卷。
