# Image 2.6 模型扩展计划

**目标：** 按用户要求在现有网站新增 `gpt-image-2.6-flare` 和 `gpt-image-2.6-sunburst`。

**设计：** 扩展前后端共用的 `STUDIO_MODELS`，两个新模型排在现有模型之前；默认仍为 `gpt-image-2`。结果预览按任务中保存的模型显示名称。沿用现有接口、数据库文本字段、任务模型快照和历史参数复用，不新增迁移或调用付费上游。

**技术：** React、TypeScript、Zod、Vitest、Playwright、PostgreSQL、Docker Compose。

## 实施与验收

- [x] 扩展 `src/contracts/studio.test.ts` 和 `src/lib/studio/storage.test.ts` 的现有模型用例；先运行定向测试，确认新模型被拒绝/降级为默认模型。
- [x] 扩展 `src/contracts/studio.ts` 中的模型列表；更新 `src/components/studio/ResultCanvas.tsx` 为四个明确模型标签，兼容历史记录缺失模型。
- [x] 扩展现有 Relay JSON/multipart、Composer 选择和端到端模型快照/历史/复用用例；检查结果标签。
- [x] 运行 typecheck、完整单测、完整 E2E、build、assert-no-secrets、audit 和版本一致性检查。测试缓存和独立测试库均放 E 盘。
- [x] 独立审查变更；更新版本、FEATURES 和交接记录，提交并推送，经 GitHub CI 后使用现有受控升级流程上线。
- [x] 核对生产版本、健康状态、模型合同和当前页面JS资源；四模型UI由本地生产构建E2E覆盖。生产浏览器直控因URL识别限制停止，未测试真实付费生成。
- [ ] 测试服务已停止，清理临时文件被自动审批以`blocked by policy`拒绝，约51MB测试库/配置/联接暂留E盘；详细证据见`.cache/logs/image26-e2e-summary.json`。
