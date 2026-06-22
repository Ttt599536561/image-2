# 阶段三验收反馈 · 20 条修改/优化（站长 2026-06-22 验收提出）

> 站长本地验收后提出 20 条。本文件 = 可勾选追踪表（断电/中断可续）。**进度只在这里 + commit 维护。**
> 4 个关键决策已确认（2026-06-22）：
> - **#9 输出格式**：gpt-image-2 实测只 png/jpeg 有效（webp 被官方忽略返 PNG，[issue#1850](https://github.com/openai/openai-node/issues/1850)）→ **加 png+jpeg 两档**，动手前花 1 张图探中转是否透传 `output_format`。
> - **#8 账号页**：**映射我们的模型**（积分余额置顶 + 积分批次/有效期 + 流水类型筛选 + 兑换记录；去竞品的订阅/月额度概念）。
> - **#14 后台分离**：**UX 彻底分离**（独立 `/admin/login` + 后台无回用户端入口 + 非 admin 重定向 + 登录直达后台；**共用同一 Better Auth 账号体系**，不另起鉴权）。
> - **#12 删生成记录**：**硬删 + 清 R2**（级联 images + 删对象，二次确认，单删/批删；ledger 保留，对账走 credit_lots 不受影响）。

## Wave A · 快赢（CSS/文案/小逻辑）✅ 完成（commit `59a09c7`）
- [x] ~~#2 删「（站长维护，点卡片一键带回提示词）」副标题~~ → 欢迎态画廊 label 改「浏览灵感」
- [x] ~~#10 后台标题贴浏览器边~~ → `.main` 顶部 padding space-6→space-8
- [x] ~~#13 兑换码查单搜索框/输入框重叠~~ → 新增 `.searchBox`/`.searchBoxInput`（外框+内无边框 input），消除框中框
- [x] ~~#6 看不到生成用时~~ → 成功态 doneTag 显「· 用时 Ns」（turn.durationMs）
- [x] ~~#7 重试还要回填输入框再点生成~~ → regenerate 改 `runGeneration(原参)` 直接发起
- [x] ~~#5 rix 报错显英文 JSON~~ → 加 `invalid_request` error_code（text 列无 CHECK、免迁移）+ failure.ts 检测 400/size/format + 前端友好中文；failureMessage 不再回退中转英文（原文仍在「查看原始响应」/后台）
- [x] ~~#15 Composer/比例/分辨率 + 右面板随滚动跑掉~~ → `Shell.module.css` `.shell` height:100dvh+overflow:hidden、`.main` min-height:0 → 内部 .flow/面板各自滚动，四周固定
- [x] ~~#16 顶部「当前对话」标题随滚动~~ → 同上（TopBar 随 shell 定高固定）

## Wave B · 图片操作 ✅ 完成（commit `5c1e5b8`）
- [x] ~~#17 本次面板「下载」实际只放大、没真下载~~ → **根因=跨域 Supabase 公链下 `<a download>` 被浏览器忽略只会开新标签**；`lib/download.ts downloadImage` 改 fetch→blob→objectURL 真下载（失败回退直链），lightbox 下载键同改（原 `<a download>` → 真下载按钮）
- [x] ~~#18 本次面板每张图直接可下载~~ → 每图右下角悬浮下载键（点图仍可放大）
- [x] ~~#19 所有生图加「复制到剪贴板」~~ → 新增 `copyImageToClipboard`（fetch blob→非 png 经 canvas 转码→`ClipboardItem(Promise<Blob>)` 保 Safari 手势激活）；成功态/本次面板/lightbox 均加「复制图片」+ toast
- [x] ~~#20 下载移图右下角、原位换复制~~ → 成功态：图右下角悬浮下载 + actionBar 首键改「复制图片」（提示词复制改 ClipboardCopy 图标避撞）；本次面板：每图右下角下载 + 图下方「复制」
- [x] ~~#1 灵感卡点击放大 + 文字悬浮~~ → Lightbox 扩 `open(src,filename?,{caption,showActions})`；灵感卡封面/渐变区点击放大（「用此提示词」阻止冒泡），放大后标题/摘要/用此提示词悬浮图上（陶土按钮，showActions:false 不显下载/复制）

## Wave C · 新能力/后端 ✅ 完成（commit `8aa24ec`）
- [x] ~~#3 左栏「最近」会话支持删除~~ → `DELETE /api/conversations/:id`（requireUserStrict owner-scoped）+ `deleteConversations`（先抓 R2 keys → 删会话级联 generations→images → 尽力删 R2，账本保留）+ 侧栏行内悬浮删除键 + 二次确认 + invalidate + 删当前会话回 "/"
- [x] ~~#12 后台生成记录支持删除~~ → `GenerationAction`(delete_generation/delete_generations_batch) + `deleteGenerations`（硬删级联 images + 清 R2 + writeAuditHttp + 账本保留）+ 后台勾选/全选/单删/批删 + 二次确认 + revalidate
- [x] ~~#9 输出格式 png/jpeg~~ → **探测否决跳过**（同 S6 范式）：`scripts/relay-format-probe.ts` 实测中转**不透传** `output_format`——`jpeg` 请求仍返 PNG（`content-type=image/png`，对照 png 也 png）。加 jpeg 药丸会误导（选了拿不到），故**不放 jpeg 档、保持只 png**；脚本保留，中转支持后再做
- [x] ~~#4 资产库自定义日期控件重做~~ → 新 `DateRangePicker`（单月日历 + ‹›翻月 + 点选起→终、越界禁用、陶土区间高亮、usePopover 外点/ESC 关）替原生 date input；纯日期逻辑下沉 `lib/assetsSelection`（monthGrid/rangeState/stepMonth/... + 14 单测）；删冗余 dateInput/dateLabel CSS

### Wave C 验证
tsc 0 · test:run 67(+14) · build 0 · assert-no-secrets PASS · **`scripts/deletes-smoke.ts` 18/18（对真 Neon：会话删级联+owner-scope、admin 删生成硬删+审计+账本保留、批删）** · reads-smoke 回归 PASS

## Wave D · 大重构
- [ ] #8 账号页重构（积分置顶 + 批次有效期 + 流水类型筛选 + 兑换记录；映射我们模型）
- [ ] #11 全局参数去毫积分：直接填积分（0.07/张等），后端仍存 mp、前端换算
- [ ] #14 管理员独立登录页 + 后台/用户端 UX 彻底分离

## 验证基线（每波做完）
tsc 0 · test:run · build · assert-no-secrets PASS；涉后端的对真 Neon smoke；`netlify dev`(8888) 浏览器自测。
