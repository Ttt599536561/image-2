import type { Size } from "../contracts/generate";
import { makePlaceholderImage } from "./images";
import type {
  Conversation,
  ExpiringSoon,
  InspirationItem,
  MockUser,
  PackageItem,
} from "./types";

// 固定种子（fixed 时间戳 → SSR/CSR 渲染一致，无 hydration mismatch）。

export const MOCK_USER: MockUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@aiworkshop.test",
  role: "user",
  createdAt: "2026-05-18T00:00:00.000Z",
};

export const DEFAULT_MAX_CONCURRENCY = 2;

// 余额 5.86 积分（=5860mp）；其中 0.07 将在 2 天后过期 → 顶栏黄点 + tooltip 演示（§24.5）。
export const SEED_BALANCE_MP = 5860;
export const SEED_EXPIRING_SOON: ExpiringSoon = {
  mp: "70",
  nearestExpiresAt: "2026-06-23T00:00:00.000Z",
};

// —— 灵感库（站长维护，封面为主体、原始比例不裁切）——
export const INSPIRATION_CATEGORIES = ["全部", "海报", "写实", "风景", "人像", "国风"] as const;

function insp(
  id: string,
  title: string,
  summary: string,
  prompt: string,
  category: string,
  size: Size,
): InspirationItem {
  const img = makePlaceholderImage(title, size);
  return { id, title, summary, prompt, category, cover: img.publicUrl, width: img.width, height: img.height };
}

export const MOCK_INSPIRATIONS: InspirationItem[] = [
  insp("i1", "电影感海报", "强对比光影、戏剧张力的竖版海报", "电影海报风格，强烈明暗对比，戏剧性聚光，电影质感颗粒，竖版构图", "海报", "1024x1536"),
  insp("i2", "黄昏山脉", "暖色调写实风景，层叠远山", "黄昏时分的层叠山脉，暖金色阳光，薄雾，写实摄影，超广角", "风景", "1536x1024"),
  insp("i3", "工作室人像", "柔光棚拍质感肖像", "影棚柔光人像，35mm，浅景深，细腻肤质，杂志封面级布光", "人像", "1024x1536"),
  insp("i4", "国风工笔花鸟", "细腻工笔、留白意境", "中国传统工笔画，花鸟，金线勾勒，绢本设色，大面积留白", "国风", "1024x1024"),
  insp("i5", "微距水珠", "写实微距、晶莹质感", "微距摄影，叶片上的水珠，清晨逆光，极致细节，写实", "写实", "1024x1024"),
  insp("i6", "赛博城市夜景", "霓虹倒影、未来都市", "赛博朋克城市夜景，霓虹灯倒影在湿润街道，体积光，电影感，16:9", "海报", "1920x1088"),
  insp("i7", "极简产品图", "纯色背景、商业静物", "极简商业产品摄影，纯色背景，柔和阴影，居中构图，方图", "写实", "1024x1024"),
  insp("i8", "国潮插画", "鲜明撞色、潮流国风", "国潮插画风格，鲜明撞色，祥云纹样，现代构成，竖屏壁纸", "国风", "1088x1920"),
  insp("i9", "雪山日照金山", "壮阔风光、冷暖对比", "雪山日照金山，纯净蓝天，冷暖对比，风光摄影，横版", "风景", "1536x1024"),
  insp("i10", "复古胶片人像", "颗粒质感、怀旧色调", "复古胶片人像，柔和颗粒，暖褐色调，自然光，7080 年代质感", "人像", "1024x1536"),
];

// —— 充值套餐（后台可配；示例对齐规格 §7：¥9.9→10、¥29.9→32）——
export const MOCK_PACKAGES: PackageItem[] = [
  {
    id: "p1",
    title: "体验装",
    description: "适合初次尝鲜，约可生成 142 张",
    priceCash: 990,
    creditsMp: 10000,
    validDays: 30,
    redirectUrl: "#",
  },
  {
    id: "p2",
    title: "标准装",
    description: "日常创作首选，更划算，约可生成 457 张",
    priceCash: 2990,
    creditsMp: 32000,
    validDays: 90,
    redirectUrl: "#",
    recommended: true,
  },
  {
    id: "p3",
    title: "尊享装",
    description: "重度创作者，积分永久有效，约可生成 1714 张",
    priceCash: 9900,
    creditsMp: 120000,
    validDays: null,
    redirectUrl: "#",
  },
];

// —— 兑换码 mock（演示各错误码 + 成功）——
export const MOCK_REDEEM: Record<string, { kind: "ok" | "used" | "disabled"; creditsMp?: number }> = {
  AAAAAAAAAAAAAAAAAA: { kind: "ok", creditsMp: 10000 }, // 成功 +10 积分
  BBBBBBBBBBBBBBBBBB: { kind: "used" }, // 已被使用 410
  CCCCCCCCCCCCCCCCCC: { kind: "disabled" }, // 已失效 410
};

// —— 初始「最近」会话（含已成功的历史轮，供 /c/:id 与「本次·N」面板演示）——
function turnImg(prompt: string, size: Size, createdAt: string, id: string) {
  const image = makePlaceholderImage(prompt, size);
  return {
    id,
    prompt,
    size,
    status: "succeeded" as const,
    image,
    createdAt,
    savedToLibrary: false,
  };
}

export const SEED_CONVERSATIONS: Conversation[] = [
  {
    id: "c-shiba",
    title: "戴针织帽的柴犬，窗边午后光",
    updatedAt: "2026-06-21T08:40:00.000Z",
    turns: [
      turnImg("戴针织帽的柴犬，窗边午后光，浅景深，治愈系", "1024x1536", "2026-06-21T08:38:00.000Z", "t-shiba-1"),
      turnImg("戴针织帽的柴犬，窗边午后光，暖色调，胶片质感", "1024x1536", "2026-06-21T08:40:00.000Z", "t-shiba-2"),
    ],
  },
  {
    id: "c-cyber",
    title: "赛博城市夜景，霓虹倒影",
    updatedAt: "2026-06-20T15:10:00.000Z",
    turns: [
      turnImg("赛博城市夜景，霓虹倒影，体积光，电影感", "1920x1088", "2026-06-20T15:10:00.000Z", "t-cyber-1"),
    ],
  },
  {
    id: "c-flower",
    title: "雨后花窗暖光，水彩质感",
    updatedAt: "2026-06-19T21:02:00.000Z",
    turns: [
      turnImg("雨后花窗暖光，水彩质感，柔和", "1024x1024", "2026-06-19T21:02:00.000Z", "t-flower-1"),
    ],
  },
];
