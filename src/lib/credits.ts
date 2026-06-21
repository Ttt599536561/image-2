// 计费常量（前端本地预校验/展示用；服务端以 app_config 为权威，402 为最终裁决）。
// 阶段二从 src/mocks/api.ts 迁出，脱离 mock 层。
export const PRICE_PER_IMAGE_MP = 70; // 0.07 积分/张（app_config.price_per_image_mp 默认）
export const SIGNUP_GRANT_MP = 140; // 注册赠送 0.14（2 张）
