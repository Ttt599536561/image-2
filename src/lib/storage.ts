// 仅保留中转 base URL 的服务端回退默认值（process.env.RELAY_BASE_URL 缺省时用）。
// 不承载任何 apiKey —— Key 一律由服务端 env 注入，前端/localStorage 不碰（密钥红线）。
// v1 的模型 localStorage 选择（loadSelectedImageModel 等）已删：模型全站固定 gpt-image-2。
export const DEFAULT_API_CONFIG = {
  baseUrl: "https://api.tangguo.xin/v1",
} as const;
