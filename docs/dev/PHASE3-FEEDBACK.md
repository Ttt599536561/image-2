# 阶段三验收反馈 · 20 条修改/优化（站长 2026-06-22 验收提出）

> 站长本地验收后提出 20 条。本文件 = 可勾选追踪表（断电/中断可续）。**进度只在这里 + commit 维护。**
> 4 个关键决策已确认（2026-06-22）：
> - **#9 输出格式**：gpt-image-2 实测只 png/jpeg 有效（webp 被官方忽略返 PNG，[issue#1850](https://github.com/openai/openai-node/issues/1850)）→ **加 png+jpeg 两档**，动手前花 1 张图探中转是否透传 `output_format`。
> - **#8 账号页**：**映射我们的模型**（积分余额置顶 + 积分批次/有效期 + 流水类型筛选 + 兑换记录；去竞品的订阅/月额度概念）。
> - **#14 后台分离**：**UX 彻底分离**（独立 `/admin/login` + 后台无回用户端入口 + 非 admin 重定向 + 登录直达后台；**共用同一 Better Auth 账号体系**，不另起鉴权）。
> - **#12 删生成记录**：**硬删 + 清 R2**（级联 images + 删对象，二次确认，单删/批删；ledger 保留，对账走 credit_lots 不受影响）。

## Wave A · 快赢（CSS/文案/小逻辑）✅ 完成（commit 见下）
- [x] #2 删「（站长维护，点卡片一键带回提示词）」副标题 → 欢迎态画廊 label 改「浏览灵感」
- [x] #10 后台 `.main` 顶部 padding space-6→space-8（标题不贴浏览器边）
- [x] #13 兑换码查单：新增 `.searchBox`/`.searchBoxInput`（外框+内无边框 input），消除框中框重叠
- [x] #6 成功态 doneTag 显「· 用时 Ns」（turn.durationMs）
- [x] #7 regenerate 改 `runGeneration(原参)` 直接发起，不回填输入框
- [x] #5 加 `invalid_request` error_code（text 列无 CHECK、免迁移）+ failure.ts 检测 400/size/format + 前端友好中文；**failureMessage 不再回退中转英文原文**（原文仍在「查看原始响应」/后台）
- [x] #15 `Shell.module.css`：`.shell` height:100dvh+overflow:hidden、`.main` min-height:0 → 内部 .flow/面板各自滚动，Composer 坞 + 右侧面板固定
- [x] #16 同上（TopBar 固定，随 shell 定高）

## Wave B · 图片操作
- [ ] #17 本次面板「下载」实际只放大、没真下载 → 修为真下载
- [ ] #18 本次面板每张图直接可下载（不用先点放大）
- [ ] #19 所有生图加「复制到剪贴板」按钮（复制图片 blob）
- [ ] #20 下载按钮移到图右下角；原下载位置换成复制；本次面板每张图下方复制 + 右下角下载
- [ ] #1 灵感卡点击放大（lightbox）+ 放大后文字仍悬浮图上（高级视觉）

## Wave C · 新能力/后端
- [ ] #3 左栏「最近」会话支持删除（新增 owner-scoped 删会话端点 + 级联 + R2 + 前端确认）
- [ ] #12 后台生成记录支持删除（硬删 + 清 R2，单删/批删 + 二次确认）
- [ ] #9 输出格式 png/jpeg（探中转透传 → Composer 格式药丸 + 契约 + 落库 content-type）
- [ ] #4 资产库自定义日期控件重做（更优雅/高级，替原生 date input）

## Wave D · 大重构
- [ ] #8 账号页重构（积分置顶 + 批次有效期 + 流水类型筛选 + 兑换记录；映射我们模型）
- [ ] #11 全局参数去毫积分：直接填积分（0.07/张等），后端仍存 mp、前端换算
- [ ] #14 管理员独立登录页 + 后台/用户端 UX 彻底分离

## 验证基线（每波做完）
tsc 0 · test:run · build · assert-no-secrets PASS；涉后端的对真 Neon smoke；`netlify dev`(8888) 浏览器自测。
