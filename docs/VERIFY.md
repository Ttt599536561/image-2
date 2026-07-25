# 验收命令红绿灯

> 本页是给**不看代码的人**设计的：AI 负责跑命令，你只负责看红绿灯。
> 规则：AI 汇报时必须贴**命令 + 退出码 + 关键输出原文**，口头说
> "通过了"一律不算数。出处：Anthropic《Claude Code Best Practices》
> "show evidence rather than asserting success"。

## 绿灯判定总则

- 🟢 **退出码 0 + 无 failed 字样** = 过
- 🔴 **任何红字 / failed / 退出码非 0** = 不过，AI 必须修完重跑
- AI 汇报格式固定为：
  ```
  命令：npm run typecheck
  结果：退出码 0
  关键输出：<贴原文最后几行>
  ```

---

## 一、每次改完代码必跑（最低门槛）

| 命令 | 检查什么 | 通过长什么样 |
|---|---|---|
| `npm run typecheck` | TypeScript 类型全站无误 | 退出码 0，无 error 输出 |
| `npm run test:run` | 全部单元/组件测试 | `Test Files X passed`，0 failed |

## 二、动到钱/积分/账单相关代码时，加跑

| 命令 | 检查什么 | 通过长什么样 |
|---|---|---|
| `npm run test:money` | 扣费、FIFO、负余额、幂等等资金用例 | 全部 passed |
| `npm run db:test:migrate` | （仅当 money 测试报数据库错时先跑它重建测试库） | 退出码 0 |

> **前置环境（本机已配好，2026-07-25 验证可用）**：
> 1. 起一次性测试库（Docker）：
>    `docker run -d --name ai-image-test-db -e POSTGRES_PASSWORD=test-only-password -e POSTGRES_DB=ai_image_test -p 5433:5432 postgres:17`
> 2. 项目根目录 `.env.test`（gitignored，已存在）必须包含：
>    `DATABASE_URL` / `DATABASE_URL_UNPOOLED`（指向 127.0.0.1:5433/ai_image_test）、
>    `MONEY_TEST_ALLOW_MUTATION=I_UNDERSTAND_THIS_IS_A_DISPOSABLE_DATABASE`、
>    `DATABASE_DRIVER=pg`、`DISPOSABLE_TEST_DB_DRIVER=pg`（缺一就会去连云数据库或云存储而失败）、
>    以及 e2e 需要的 `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` /
>    `CUSTOM_KEY_JOB_ENCRYPTION_KEY` / `CUSTOM_KEY_MODES_ENABLED=true`
> 3. 测试库结构变更后跑 `npm run db:test:migrate` 同步表结构。
> 若容器被删，按上面第 1 步重建再迁移即可，数据本来就是一次性的。

> 资金规则是本项目"不可破坏"区（见 CLAUDE.md），相关改动没有
> money 测试全绿**禁止提交**。

## 三、动到页面/交互时，加跑

| 命令 | 检查什么 | 通过长什么样 |
|---|---|---|
| `npm run test:e2e` | Playwright 开真实浏览器走用户流程 | 全部 spec passed |
| 浏览器截图 | AI 须像真人一样操作页面并截图给你核对 | 截图与预期一致 |

> 出处：《Effective Harnesses for Long-Running Agents》——网页功能
> 必须端到端验收，光跑单元测试不算完成。
>
> ⚠️ **已知本机情况（2026-07-25 实测）**：`tests/e2e/key-modes.spec.ts`
> 中个别用例依赖浏览器轮询节奏，在 Windows dev 服务器下偶发超时
> （表现为"已完成/请求超时"字样等不到），同一用例换个轮次又能通过。
> 判定方法：偶发超时 ≠ 产品缺陷——若 money 真库套件全绿而 e2e 仅
> 个别轮询断言超时，可重跑一次确认；若同一断言**连续三次**失败，
> 才按缺陷处理。

## 四、准备上线/发布时，加跑

| 命令 | 检查什么 |
|---|---|
| `npm run build` | 生产构建成功 |
| `npm run assert-no-secrets` | 构建产物里没有泄露密钥 |
| `npm run release:validate` | 版本号、tag、质量门完整 |
| `npm run test:deploy` | （改了 deploy/ 脚本才需要）部署脚本契约测试 |

> ⚠️ **push 到 main 即触发 GitHub CI**（audit/typecheck/单测/build/密钥
> 断言）。纪律（2026-07-25 CI 失败教训）：push 前必须本地先跑
> `npm run build` 和 `npm audit --audit-level=high`；push 后必须用
> check-runs API 或 Actions 页面**盯到 ci 变绿才算任务完成**，不许
> "推完就走"。CVE 库会持续更新：同一个 lock 昨天绿不代表今天绿，
> audit 失败先查是不是新披露命中了旧依赖，再按"评估攻击面 + 升级"处理。

## 五、AI 常见糊弄话术，看到就打回

- ❌ "逻辑上没问题" → 贴命令输出
- ❌ "测试基本通过" → "基本"是几个？贴数字
- ❌ "这个报错不影响功能" → 修到没有报错为止
- ❌ 只贴结论不贴原文 → 必须贴原文最后几行
