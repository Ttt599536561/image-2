# 本地验收

本文件用于本地 disposable 环境验证，不是生产部署手册。生产只按
[deploy.md](deploy.md) 执行。

## 自动验证

```bash
npm run typecheck
npm run test:run
npm run test:money
npm run build
npm run assert-no-secrets
npm run docker:validate
npm run test:deploy
npm run test:deploy:smoke
```

金额测试使用 gitignored 的 `.env.test` 和一次性本地 PostgreSQL；guard 必须拒绝生产候选数据库。部署 smoke 会真实启动空 Compose 栈并自行清理，不使用生产配置或数据卷。

## 浏览器验收

`npm run dev:disposable:test` 会加载 `.env.test`
并在 `http://localhost:8888` 启动 React Router。它不是 Docker 生产模拟器，也不会
启动 worker，因此只用于页面、鉴权和同步 API 验收：

```bash
npm run dev:disposable:test
```

仓库当前没有“自动向 worker 注入 `.env.test`”的受保护命令。完整生成链路应使用
隔离的非生产环境按 Docker 手册启动，或运行自动化测试；不要直接执行
`npm run start:worker` 后假定它读取了 `.env.test`。不要把 `.env` 复制为
`.env.test`，也不要将生产 relay、存储或数据库凭据用于可写 smoke。

## 手工覆盖范围

- 注册、登录、受保护路由和管理员权限。
- system 文生图/图生图：成功落图后只扣一次；失败或超时不扣。
- custom 模式：生产默认开放，可连续提交，多任务状态互不覆盖，本站余额/账本不变；
  显式关闭 kill switch 时验证 `503` 且零写入。
- custom 成功、失败和超时后 `generation_credentials` 无对应明文或遗留记录。
- 兑换、资产删除/下载、灵感投稿审核和后台审计按 owner/admin 权限工作。

本地结果不能写成目标服务器已经验收；服务器步骤以 [deploy.md](deploy.md) 为准。
