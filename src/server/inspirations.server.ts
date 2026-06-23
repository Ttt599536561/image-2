// ★server-only：灵感库种子（§6 admin 建 inspirations 表前的数据源；/api/inspirations 读它）。
// 接 §6 后只需把 reads.server 的 loadInspirations 换成查表，前端零改动。封面用占位 data URL（真 cover 走 public_url）。
import type { InspirationItem } from "../contracts/inspiration";
import type { Size } from "../contracts/generate";
import { makePlaceholderImage } from "../lib/placeholder";

function insp(
  id: string,
  title: string,
  summary: string,
  prompt: string,
  category: string,
  size: Size,
): InspirationItem {
  const img = makePlaceholderImage(title, size);
  return { id, title, summary, prompt, category, cover: img.publicUrl, width: img.width, height: img.height, submitter: null };
}

export const SEED_INSPIRATIONS: InspirationItem[] = [
  insp("11111111-1111-4111-8111-000000000001", "电影感海报", "强对比光影、戏剧张力的竖版海报", "电影海报风格，强烈明暗对比，戏剧性聚光，电影质感颗粒，竖版构图", "海报", "1024x1536"),
  insp("11111111-1111-4111-8111-000000000002", "黄昏山脉", "暖色调写实风景，层叠远山", "黄昏时分的层叠山脉，暖金色阳光，薄雾，写实摄影，超广角", "风景", "1536x1024"),
  insp("11111111-1111-4111-8111-000000000003", "工作室人像", "柔光棚拍质感肖像", "影棚柔光人像，35mm，浅景深，细腻肤质，杂志封面级布光", "人像", "1024x1536"),
  insp("11111111-1111-4111-8111-000000000004", "国风工笔花鸟", "细腻工笔、留白意境", "中国传统工笔画，花鸟，金线勾勒，绢本设色，大面积留白", "国风", "1024x1024"),
  insp("11111111-1111-4111-8111-000000000005", "微距水珠", "写实微距、晶莹质感", "微距摄影，叶片上的水珠，清晨逆光，极致细节，写实", "写实", "1024x1024"),
  insp("11111111-1111-4111-8111-000000000006", "赛博城市夜景", "霓虹倒影、未来都市", "赛博朋克城市夜景，霓虹灯倒影在湿润街道，体积光，电影感，16:9", "海报", "1920x1088"),
  insp("11111111-1111-4111-8111-000000000007", "极简产品图", "纯色背景、商业静物", "极简商业产品摄影，纯色背景，柔和阴影，居中构图，方图", "写实", "1024x1024"),
  insp("11111111-1111-4111-8111-000000000008", "国潮插画", "鲜明撞色、潮流国风", "国潮插画风格，鲜明撞色，祥云纹样，现代构成，竖屏壁纸", "国风", "1088x1920"),
  insp("11111111-1111-4111-8111-000000000009", "雪山日照金山", "壮阔风光、冷暖对比", "雪山日照金山，纯净蓝天，冷暖对比，风光摄影，横版", "风景", "1536x1024"),
  insp("11111111-1111-4111-8111-00000000000a", "复古胶片人像", "颗粒质感、怀旧色调", "复古胶片人像，柔和颗粒，暖褐色调，自然光，7080 年代质感", "人像", "1024x1536"),
];
