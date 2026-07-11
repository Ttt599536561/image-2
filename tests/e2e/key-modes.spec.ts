import { expect, test } from "@playwright/test";
import {
  cleanupTestUsers,
  closeKeyModeFixture,
  installGenerationHarness,
  loginTestUser,
  registerTestUser,
  setBalanceZero,
} from "./key-mode-fixture";

test.describe.serial("user API key modes", () => {
  let cleanupEmails: string[] = [];

  test.beforeEach(() => {
    cleanupEmails = [];
  });

  test.afterEach(async () => {
    await cleanupTestUsers(cleanupEmails);
  });

  test.afterAll(async () => {
    await closeKeyModeFixture();
  });

  test("system mode omits custom credentials and locks until terminal", async ({ page }) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);
    const harness = await installGenerationHarness(page, user.id);
    const textarea = page.locator("textarea").first();
    const generate = page.getByRole("button", { name: "生成", exact: true });

    await textarea.fill("系统模式排队测试");
    await generate.click();
    await expect.poll(() => harness.requests.length).toBe(1);
    await expect(generate).toBeDisabled();
    expect(harness.requests[0]?.credentialMode).toBe("system");
    expect(Object.hasOwn(harness.requests[0] ?? {}, "customApiKey")).toBe(false);
    expect(Object.hasOwn(harness.requests[0] ?? {}, "baseUrl")).toBe(false);

    await harness.completeFailure(String(harness.requests[0]?.generationId));
    await expect(page.getByText(/请求超时/)).toBeVisible();
    await expect(textarea).toBeEnabled();
    await textarea.fill("系统模式已解锁");
    await expect(generate).toBeEnabled();
  });

  test("custom mode runs three zero-balance tasks without site charges", async ({ page }) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);
    await setBalanceZero(user.id);
    await page.reload();
    const harness = await installGenerationHarness(page, user.id);

    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await page.getByRole("radio", { name: "自定义 Key" }).click();
    await page.getByLabel("自定义 Key 内容").fill(["local", "browser", "fixture"].join("-"));
    await page.getByRole("button", { name: "保存并使用" }).click();
    await expect(page.getByText("使用自定义 Key · 本站不扣积分")).toBeVisible();

    for (let index = 0; index < 3; index += 1) {
      await expect(page.getByText("使用自定义 Key · 本站不扣积分")).toBeVisible();
      const textarea = page.locator("textarea").first();
      await expect(textarea).toBeEnabled();
      await textarea.fill(`自定义模式并行任务 ${index + 1}`);
      const generate = page.getByRole("button", { name: "生成", exact: true });
      await expect(generate).toBeEnabled();
      await generate.click();
      await expect.poll(() => harness.requests.length).toBe(index + 1);
      if (index === 0) await page.waitForURL(/\/c\/[0-9a-f-]+$/i);
      await expect(textarea).toHaveValue("");
      await expect(textarea).toBeEnabled();
    }

    expect(harness.requests.every((body) => body.credentialMode === "custom")).toBe(true);
    expect(harness.requests.every((body) => !Object.hasOwn(body, "baseUrl"))).toBe(true);
    expect(new Set(harness.requests.map((body) => body.customApiKey)).size).toBe(1);
    expect(harness.requests.every((body) => typeof body.customApiKey === "string")).toBe(true);

    await harness.completeSuccess(String(harness.requests[2]?.generationId));
    await harness.completeFailure(String(harness.requests[0]?.generationId));
    await harness.completeSuccess(String(harness.requests[1]?.generationId));

    await expect(page.getByText("已完成")).toHaveCount(2);
    await expect(page.getByText(/本站未扣积分；第三方计费/)).toBeVisible();
    await expect(page.getByText(/0 积分/).first()).toBeVisible();
  });

  test("deadline confirmation keeps polling and reload restores the terminal state", async ({ page }) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);
    const harness = await installGenerationHarness(page, user.id, { deadlineOffsetMs: -11_000 });

    await page.locator("textarea").fill("deadline 恢复测试");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => harness.requests.length).toBe(1);
    await expect(page.getByText("状态确认中，请重试刷新")).toBeVisible();
    const requestCount = harness.statusRequestCount;
    await expect.poll(() => harness.statusRequestCount, { timeout: 6_000 }).toBeGreaterThan(requestCount);

    await harness.completeFailure(String(harness.requests[0]?.generationId));
    await expect(page.getByText(/请求超时/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/请求超时/)).toBeVisible();
  });

  test("missing tasks become a prompt-preserving tombstone and stop only their poll", async ({ page }) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);
    const harness = await installGenerationHarness(page, user.id);
    const detailResponse = page.waitForResponse((response) =>
      /\/api\/conversations\/[0-9a-f-]+$/i.test(new URL(response.url()).pathname),
    );

    const textarea = page.locator("textarea").first();
    await textarea.fill("missing 状态恢复测试");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => harness.requests.length).toBe(1);
    await detailResponse;
    await harness.removeGeneration(String(harness.requests[0]?.generationId));

    await expect(page.getByText("任务不存在或无权访问")).toBeVisible();
    await expect(
      page.getByRole("main").getByText("missing 状态恢复测试", { exact: true }),
    ).toBeVisible();
    const settledRequestCount = harness.statusRequestCount;
    await page.waitForTimeout(2_500);
    expect(harness.statusRequestCount).toBe(settledRequestCount);

    await textarea.fill("system 锁已解除");
    await expect(page.getByRole("button", { name: "生成", exact: true })).toBeEnabled();
  });

  test("browser config persists per account and clears explicitly", async ({ page }) => {
    const first = await registerTestUser(page);
    cleanupEmails.push(first.email);
    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await page.getByRole("radio", { name: "自定义 Key" }).click();
    await page.getByLabel("自定义 Key 内容").fill(["local", "account", "fixture"].join("-"));
    await page.getByRole("button", { name: "保存并使用" }).click();

    await page.reload();
    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await expect(page.getByRole("radio", { name: "自定义 Key" })).toBeChecked();
    await expect.poll(async () => (await page.getByLabel("自定义 Key 内容").inputValue()).length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "关闭" }).click();

    await page.goto("/account");
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.waitForURL("**/login");
    const second = await registerTestUser(page);
    cleanupEmails.push(second.email);
    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await expect(page.getByRole("radio", { name: "系统 Key" })).toBeChecked();
    await page.getByRole("button", { name: "关闭" }).click();

    await page.goto("/account");
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.waitForURL("**/login");
    await loginTestUser(page, first.email);
    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await expect(page.getByRole("radio", { name: "自定义 Key" })).toBeChecked();
    await page.getByRole("button", { name: "清除自定义 Key" }).click();
    await expect(page.getByRole("radio", { name: "系统 Key" })).toBeChecked();
    await page.getByRole("button", { name: "关闭" }).click();
    await page.reload();
    await page.getByRole("button", { name: /生图 Key 设置/ }).click();
    await expect(page.getByRole("radio", { name: "系统 Key" })).toBeChecked();
  });

  test("modal is keyboard-safe and has no overflow at four viewports", async ({ page }, testInfo) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);

    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 360 ? 720 : 900 });
      const trigger = page.getByRole("button", { name: /生图 Key 设置/ });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "API 配置" });
      await expect(dialog).toBeVisible();
      const close = page.getByRole("button", { name: "关闭" });
      await expect(close).toBeFocused();
      await page.getByRole("radio", { name: "自定义 Key" }).click();
      await expect(page.getByText(/第三方可能按服务商规则计费/)).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`key-modes-${width}.png`), fullPage: true });

      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "保存并使用" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "关闭" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });
});
