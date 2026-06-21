// 站点级常量（前后端共用，纯常量、无副作用）。

// 第三方店铺购买默认跳转 URL（站长 2026-06-22 给）。套餐 redirect_url 为空时统一跳这里；
// ⑥ 后台「套餐管理」可按套餐覆盖 per-package redirect_url。
export const DEFAULT_PURCHASE_URL = "https://www.ldxp.cn/merchant/goods/list?is_proxy=0";
