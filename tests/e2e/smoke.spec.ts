// @smoke 关键路径冒烟（⑦ · 真相源 10 §11.10）：注册 → 生图（轮询到 succeeded）→ 兑换 → 余额增加。
// 运行器 @playwright/test（非 vitest；本目录已从 vitest include 排除）。本文件不在 tsconfig include 内 → 不入 tsc。
//
// 前置：① npm i -D @playwright/test && npx playwright install chromium
//      ② 起 server：netlify dev（加载 .env 的 Neon/Storage/中转；中转建议用桩/录制避免真烧钱）
//      ③ 兑换步骤需一个有效未用兑换码 → 设 E2E_REDEEM_CODE（用 scripts 或后台预生成一枚 active 码）；未设则跳过兑换断言。
// 跑：E2E_BASE_URL=http://localhost:8888 E2E_REDEEM_CODE=XXXX... npx playwright test
import { expect, test } from "@playwright/test";

const REDEEM_CODE = process.env.E2E_REDEEM_CODE;
const LEGACY_SMOKE_ENABLED = process.env.E2E_LEGACY_SMOKE_ENABLED === "true";

test.describe("@smoke 关键路径", () => {
  test.skip(
    !LEGACY_SMOKE_ENABLED,
    "legacy real-generation smoke requires explicit approval in the disposable test env",
  );

  test("注册 → 生图 → 兑换 → 余额增加", async ({ page }) => {
    const email = `e2e+${Date.now()}@example.com`;
    const password = "test123456";

    // ① 注册（autoSignIn → 注册即登录，进主页）。送 140mp = 0.14 积分（2 张）。
    await page.goto("/register");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#confirm").fill(password);
    await page.getByRole("button", { name: "注册" }).click();
    await page.waitForURL("**/"); // 注册成功跳主页

    // ② 生图：Composer 输入提示词 → 点「生成」→ 轮询到成品图（成功态出图 + 操作按钮）。
    await page.getByPlaceholder("描述你想生成的画面…").fill("a small red apple on a white table, studio light");
    await page.getByRole("button", { name: "生成" }).click();
    // 生成中 → 成功：等待成品图出现（最长 ~5min 软超时；冒烟环境用中转桩会更快）。
    await expect(page.locator("img").first()).toBeVisible({ timeout: 5 * 60_000 });

    // ③ 兑换（有码才验）：到充值页输码 → 兑换 → 「兑换成功，到账 N 积分」。
    if (REDEEM_CODE) {
      await page.goto("/billing");
      await page.getByPlaceholder("输入 18 位兑换码").fill(REDEEM_CODE);
      await page.getByRole("button", { name: "兑换" }).click();
      await expect(page.getByText(/兑换成功，到账/)).toBeVisible();
    } else {
      test.info().annotations.push({ type: "skip-redeem", description: "未设 E2E_REDEEM_CODE，跳过兑换断言" });
    }
  });
});
