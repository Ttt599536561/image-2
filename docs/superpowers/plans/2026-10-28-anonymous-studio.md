# Anonymous Studio Implementation Plan

> For agentic workers: use subagent-driven-development for the bounded parallel units below; root owns integration and final verification.

**Goal:** 将现有站点替换为无需账户、仅URL+Key的三栏生图工作台，并部署到当前服务器。

**Architecture:** 复用custom持久队列与worker，新增匿名session和限定studio API，安全冻结上游凭据；浏览器IndexedDB管理历史与图片。禁用旧用户计费入口，管理员只保留运维。

**Tech Stack:** React Router 8、React 19、TypeScript、PostgreSQL 17、Node HTTPS、IndexedDB、Vitest、Playwright、Docker/Caddy。

## Tasks

- [x] 安全网络与凭据：先补私网/重绑定/redirect/响应上限与凭据快照测试，再实现DNS绑定HTTPS请求；扩展custom凭据可冻结baseUrl，保留旧调用签名兼容；图片下载也走安全请求。
- [x] 匿名API：先补会话隔离、跨站写拒绝、无账户入队、同ID重放、限流与媒体访问测试；添加0012 session映射，基于token hash解析owner；路由实现严格src/contracts/studio.ts协议，使用现有状态与NOTIFY模块。
- [x] 工作台：先补配置remember语义/历史限额/参数与提交交互测试；拆分Studio、ConnectionPanel、Controls、Result、History和IndexedDB适配器；实现80/352/弹性三栏及移动收起面板。
- [x] 集成：根路径路由接studio，welcome/login/register/billing/account等旧页redirect；普通旧API不再注册；仅保留必要管理员运维API。移除计费scheduler调用、认证补发积分、media静态绕过；版本0.3.0。
- [x] 测试：隔离E盘数据库，不用开发或生产库；更新E2E为匿名文生图/图生图/刷新/隔离/Key不落历史/移动工作台。运行npm run typecheck、test:run、test:money、test:e2e、build、assert-no-secrets、npm audit --audit-level=high与test:deploy。
- [x] 独立审查并修复；提交、快进main、推送、等待CI；备份新机DB与env、拉取、迁移、重建镜像、保持数据卷，检查正式域名无登录页面和拒绝缺Key生图。更新交接与验收证据。

Implementation details and exact API shapes are fixed in tasks/2026-10-28-anonymous-studio.md and src/contracts/studio.ts; files have one owner per parallel task. New tests must fail for the intended behavior before production changes, with isolated test fixtures and no paid provider calls.
