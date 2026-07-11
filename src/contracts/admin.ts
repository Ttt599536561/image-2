// 后台契约（09 §10.1）。前后端单一真相源；🔴 客户端可达 → 手写 Zod，绝不 value-import db/schema（⑤ 教训）。
// 写端点用 op 判别联合（一个资源一个 action 端点，减面）；响应形状由 server 模块的 TS 接口给（loader 直出类型）。
import { z } from "zod";
import { classifyAnnouncementLink } from "../lib/announcementLink";
import { passwordField } from "./account";
import { PublicMediaUrlSchema } from "./public-media-url";
import { REDEEM_ALPHABET } from "./redeem";

export { REDEEM_ALPHABET };

// ===================== 兑换码 =====================
export const GenerateCodesAction = z.object({
  op: z.literal("generate"),
  packageId: z.uuid(),
  count: z.number().int().positive().max(5000), // 软上限防超大事务（09 §10.2）
});
export const DisableBatchAction = z.object({
  op: z.literal("disable_batch"),
  batchId: z.uuid(),
});
export const CodeAction = z.discriminatedUnion("op", [GenerateCodesAction, DisableBatchAction]);
export type CodeAction = z.infer<typeof CodeAction>;

// ===================== 用户操作（行尾「⋯」下拉，09 §10.3）=====================
export const BanAction = z.object({
  op: z.literal("ban"),
  banned: z.boolean(),
  reason: z.string().max(500).optional(),
});
export const ResetPwAction = z.object({
  op: z.literal("reset_pw"),
  newPassword: passwordField, // ≥6 且 ≤72 字节（防 bcrypt 截断，05 §6.4）
});
export const AdjustCreditAction = z.object({
  op: z.literal("adjust_credit"),
  deltaMp: z.number().int().refine((n) => n !== 0, "调整额不能为 0"),
  reason: z.string().min(1, "原因必填").max(500),
  validDays: z.number().int().positive().nullable().optional(), // 仅增额生效；NULL=永久
});
export const ConcurrencyAction = z.object({
  op: z.literal("set_concurrency"),
  maxConcurrency: z.number().int().min(1).max(50),
});
export const UserAction = z.discriminatedUnion("op", [BanAction, ResetPwAction, AdjustCreditAction, ConcurrencyAction]);
export type UserAction = z.infer<typeof UserAction>;

// ===================== 套餐 CRUD（软删，09 §10.6）=====================
const packageFields = {
  title: z.string().min(1, "标题必填").max(100),
  description: z.string().max(500).nullable().optional(),
  priceCash: z.number().int().positive("价格须 >0"),
  creditsMp: z.number().int().positive("积分须 >0"),
  validDays: z.number().int().positive().nullable(), // ≥1 或 NULL=永久
  redirectUrl: z.string().max(1000).nullable().optional(),
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
};
export const CreatePackageAction = z.object({ op: z.literal("create"), ...packageFields });
export const UpdatePackageAction = z.object({ op: z.literal("update"), id: z.uuid(), ...packageFields });
export const DeletePackageAction = z.object({ op: z.literal("delete"), id: z.uuid() }); // 软删 active=false
export const PackageAction = z.discriminatedUnion("op", [CreatePackageAction, UpdatePackageAction, DeletePackageAction]);
export type PackageAction = z.infer<typeof PackageAction>;

// ===================== 全局参数（app_config，09 §10.6）=====================
// 本期可改的数值键（relay_base_url 字符串键留增强）。每键最小值约束在 config.server 按 key 校验。
export const CONFIG_KEYS = [
  "price_per_image_mp",
  "signup_grant_mp",
  "signup_grant_valid_days",
  "retention_free_days",
  "retention_paid_days",
  "default_max_concurrency",
  "daily_relay_budget_calls",
  "daily_relay_budget_ms",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export const ConfigUpdateRequest = z.object({
  updates: z
    .array(z.object({ key: z.enum(CONFIG_KEYS), value: z.number().int().nonnegative() }))
    .min(1, "无改动"),
});
export type ConfigUpdateRequest = z.infer<typeof ConfigUpdateRequest>;

// ===================== 中转站配置（app_config: relay_base_url / relay_api_key，方便换厂商）=====================
// 🔴 baseUrl 可改可见（非密）；apiKey **写后即焚**——只在非空时提交更新、GET 永不回明文（server 只回末 4 位 hint）。
// 客户端可达 → 手写 Zod、绝不 import db/schema（⑤ 教训）；URL 格式终判在 server。
export const RelayConfigUpdateRequest = z
  .object({
    baseUrl: z.string().max(2000).optional(),
    apiKey: z.string().max(500).optional(), // 留空=不改 key
  })
  .refine(
    (v) => (v.baseUrl != null && v.baseUrl.trim() !== "") || (v.apiKey != null && v.apiKey.trim() !== ""),
    "无改动",
  );
export type RelayConfigUpdateRequest = z.infer<typeof RelayConfigUpdateRequest>;

// ===================== 灵感库 CRUD（09 §10.4）=====================
const inspFields = {
  title: z.string().min(1, "标题必填").max(100),
  cover: z.string().min(1, "封面必填").max(2000), // cover_url（admin 贴公有 URL；multipart 上传留增强）
  category: z.string().max(50).nullable().optional(),
  prompt: z.string().min(1, "提示词必填").max(4000),
  summary: z.string().max(500).nullable().optional(),
  width: z.number().int().positive().max(100000).nullable().optional(), // 封面原始宽高（瀑布流原比例，P3-S4，可空）
  height: z.number().int().positive().max(100000).nullable().optional(),
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
};
export const CreateInspAction = z.object({ op: z.literal("create"), ...inspFields });
export const UpdateInspAction = z.object({ op: z.literal("update"), id: z.uuid(), ...inspFields });
export const DeleteInspAction = z.object({ op: z.literal("delete"), id: z.uuid() });
// 排序：与相邻卡互换并规整 sort（P3-S4「排序编辑体验」），避免手填 sort 数字。
export const ReorderInspAction = z.object({
  op: z.literal("reorder"),
  id: z.uuid(),
  direction: z.enum(["up", "down"]),
});
export const InspirationAction = z.discriminatedUnion("op", [
  CreateInspAction,
  UpdateInspAction,
  DeleteInspAction,
  ReorderInspAction,
]);
export type InspirationAction = z.infer<typeof InspirationAction>;

// 灵感封面本地上传（multipart）响应：只回公有 URL，前端填进表单 cover（cover_key 由服务端据 cover_url 派生）。
export const InspirationCoverUploadResponse = z.object({
  coverUrl: PublicMediaUrlSchema,
});
export type InspirationCoverUploadResponse = z.infer<typeof InspirationCoverUploadResponse>;

// ===================== 灵感投稿审核（§13.1）=====================
// 通过可先改字段（封面/宽高来自投稿图，不在此填）；驳回必填原因。一经审核即终态（服务端校验 status=pending）。
export const ApproveSubmissionAction = z.object({
  op: z.literal("approve"),
  id: z.uuid(),
  title: z.string().min(1, "标题必填").max(100),
  prompt: z.string().min(1, "提示词必填").max(4000),
  category: z.string().max(50).nullable().optional(),
  summary: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(), // 缺省=上架
});
export const RejectSubmissionAction = z.object({
  op: z.literal("reject"),
  id: z.uuid(),
  reason: z.string().min(1, "驳回原因必填").max(500),
});
export const SubmissionReviewAction = z.discriminatedUnion("op", [
  ApproveSubmissionAction,
  RejectSubmissionAction,
]);
export type SubmissionReviewAction = z.infer<typeof SubmissionReviewAction>;

// ===================== 站内通知：广播公告（§9）=====================
// link 可空：站内路径（/assets…）前台走 navigate，外链（http(s)://…）走 window.open。
// 🔴 link 安全分类（站内单层路径 / http(s) 外链 / 拒绝）抽到 src/lib/announcementLink 前后端单一真相源，
//    挡 `javascript:`/协议相对 `//evil`/反斜杠 `/\evil`（浏览器规整为 `//` 的开放重定向）。
export const announcementLink = z
  .string()
  .max(1000)
  .refine((s) => classifyAnnouncementLink(s) !== null, "链接须为站内路径(/…)或 http(s) 外链");
// 公告正文三件套（broadcast 下发 + edit 改写共用）。
const announcementContent = {
  title: z.string().min(1, "标题必填").max(120),
  body: z.string().min(1, "内容必填").max(2000),
  link: announcementLink.nullable().optional(),
};
export const BroadcastAnnouncementAction = z.object({
  op: z.literal("broadcast"),
  ...announcementContent,
  target: z.enum(["all", "paid"]), // 全体 / 仅付费用户(has_paid=true)
});
// ①增强（2026-06-22）：编辑已发公告——按 aid 批量改 'announcement:<aid>:%' 行的 payload（同步用户端）。
// renotify=true → 同时把这波行 read_at 置 NULL「重新提醒」（重弹红点）；默认 false=静默改内容。
export const EditAnnouncementAction = z.object({
  op: z.literal("edit"),
  aid: z.uuid(), // 公告 id（dedupe_key 第 2 段拆出，uuid → LIKE 模式无通配注入）
  ...announcementContent,
  renotify: z.boolean().optional().default(false),
});
// ①增强：删除已发公告——批量删该波行（用户端立即消失）。
export const DeleteAnnouncementAction = z.object({
  op: z.literal("delete"),
  aid: z.uuid(),
});
export const AnnouncementAction = z.discriminatedUnion("op", [
  BroadcastAnnouncementAction,
  EditAnnouncementAction,
  DeleteAnnouncementAction,
]);
export type AnnouncementAction = z.infer<typeof AnnouncementAction>;

// ===================== 生成记录删除（#12 硬删 + 清 R2，单删/批删）=====================
// 账本（credit_ledger）保留：对账走 credit_lots，不受删除影响。
export const DeleteGenerationAction = z.object({
  op: z.literal("delete_generation"),
  id: z.uuid(),
});
export const DeleteGenerationsBatchAction = z.object({
  op: z.literal("delete_generations_batch"),
  ids: z.array(z.uuid()).min(1).max(200), // 软上限防超大事务
});
export const GenerationAction = z.discriminatedUnion("op", [
  DeleteGenerationAction,
  DeleteGenerationsBatchAction,
]);
export type GenerationAction = z.infer<typeof GenerationAction>;
