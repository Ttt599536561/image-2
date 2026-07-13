# 灵感投稿与审核记录

状态：功能已在 `0.2.0` 实现并部署；空数据 Docker smoke 与腾讯云生产基础验证已通过。真实 Relay 与 UGC 复查按 [PROGRESS.md](../PROGRESS.md) 的运维周期执行。

- [x] 用户可从自己的作品提交灵感投稿，不扣积分。
- [x] 投稿使用独立 `inspiration_submissions` 队列与永久副本，避免前台读到待审内容。
- [x] 管理员可通过/驳回并写审计、通知投稿人；通过后创建公开 inspiration 卡并使用掩码署名。
- [x] owner-scope、重复投稿保护、对象孤儿保护和权限测试已实现。

接口和数据库契约在 `src/contracts/inspirationSubmission.ts`、相关 resource routes、`src/server` 与 Drizzle migrations 中。当前发布状态见 [PROGRESS.md](../PROGRESS.md)。
