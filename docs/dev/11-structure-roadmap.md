# 代码结构与演进

状态：v2、阶段二、阶段三、UGC 与 Key 模式本地实现均已完成；当前唯一发布主线见 [PROGRESS.md](../PROGRESS.md)。

## 当前结构

```text
app/                    React Router 页面与资源路由
src/contracts/          Zod 请求/响应契约
src/db/                 Drizzle schema、连接工厂、seed
src/server/             relay、存储、鉴权、钱事务、generation 状态机
src/server/generation/  enqueue、process、deadline、credential、worker
scripts/                worker、scheduler、migration、受控运维脚本
drizzle/                迁移 SQL
deploy/                 Caddy 与生产环境模板
compose.yaml            Caddy/web/worker/scheduler 拓扑
Dockerfile              Node 22 多阶段生产镜像
netlify/                迁移期兼容 handler 源码，待后续抽取后移除
```

## 边界

- `app/routes` 只适配 HTTP；业务逻辑放 `src/server`。
- `generations` 是队列和状态真相源；worker 是唯一长任务执行者。
- 钱、码和并发一致性使用 transaction pool + `FOR UPDATE`；读模型和单语句原子操作可使用 HTTP。
- 浏览器只能引用 `src/contracts` 与跨端工具，不能 value-import DB schema 或服务端 secrets。
- Docker 镜像以相同应用源运行 web、worker、scheduler；只有 Caddy 暴露端口。

## 后续演进

- 将 `netlify/functions` handler 抽到平台无关模块并重命名目录，再删除兼容触发 helper；Netlify CLI、插件、Blobs 依赖与平台配置已经移除。
- 先完成 Debian 生产 rollout，再根据真实吞吐决定是否扩大 worker 或引入 Redis/Valkey + BullMQ。
- 不因“服务器资源充足”迁移数据库或对象存储；先以 Neon/Supabase 的监控、备份和成本数据决策。

已完成阶段的逐项任务、v1→v2 文件映射和依赖历史在 Git 中保留，不再维护重复 checkbox。
