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

> 资金规则是本项目"不可破坏"区（见 CLAUDE.md），相关改动没有
> money 测试全绿**禁止提交**。

## 三、动到页面/交互时，加跑

| 命令 | 检查什么 | 通过长什么样 |
|---|---|---|
| `npm run test:e2e` | Playwright 开真实浏览器走用户流程 | 全部 spec passed |
| 浏览器截图 | AI 须像真人一样操作页面并截图给你核对 | 截图与预期一致 |

> 出处：《Effective Harnesses for Long-Running Agents》——网页功能
> 必须端到端验收，光跑单元测试不算完成。

## 四、准备上线/发布时，加跑

| 命令 | 检查什么 |
|---|---|
| `npm run build` | 生产构建成功 |
| `npm run assert-no-secrets` | 构建产物里没有泄露密钥 |
| `npm run release:validate` | 版本号、tag、质量门完整 |
| `npm run test:deploy` | （改了 deploy/ 脚本才需要）部署脚本契约测试 |

## 五、AI 常见糊弄话术，看到就打回

- ❌ "逻辑上没问题" → 贴命令输出
- ❌ "测试基本通过" → "基本"是几个？贴数字
- ❌ "这个报错不影响功能" → 修到没有报错为止
- ❌ 只贴结论不贴原文 → 必须贴原文最后几行
