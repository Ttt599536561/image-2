// @e2e 侧边栏项目分组（F-074）：默认项目懒创建归属、展开/收起、新建/重命名弹窗、
// 项目内会话与项目的长按拖动排序，全程验证刷新持久化。
// 运行器 @playwright/test（非 vitest）。生成走 installGenerationHarness 桩（同 key-modes），不碰真实 relay。
import { expect, test } from "@playwright/test";
import {
  cleanupTestUsers,
  closeKeyModeFixture,
  installGenerationHarness,
  registerTestUser,
} from "./key-mode-fixture";

test.describe("sidebar projects", () => {
  const cleanupEmails: string[] = [];

  test.afterEach(async () => {
    await cleanupTestUsers(cleanupEmails.splice(0));
  });

  test.afterAll(async () => {
    await closeKeyModeFixture();
  });

  test("默认项目归属 + 展开收起 + 新建/重命名 + 长按排序，刷新后保持", async ({ page }) => {
    const user = await registerTestUser(page);
    cleanupEmails.push(user.email);
    const harness = await installGenerationHarness(page, user.id);
    const aside = page.locator("aside");

    // ① 新用户：项目区为空
    await expect(aside.getByText("还没有对话，点「新建生成」开始吧")).toBeVisible();

    // ② 第一次生成 → 默认项目自动出现，会话归入其中
    await page.locator("textarea").first().fill("项目归属测试图");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => harness.requests.length).toBe(1);
    await expect(aside.getByText("默认项目")).toBeVisible();
    await expect(aside.getByText("项目归属测试图")).toBeVisible();

    // ③ 点击项目行：收起 ↔ 展开
    await aside.getByText("默认项目").click();
    await expect(aside.getByText("项目归属测试图")).toBeHidden();
    await aside.getByText("默认项目").click();
    await expect(aside.getByText("项目归属测试图")).toBeVisible();

    // ④ 第二次生成也归入默认项目，且排在最上（走「新建生成」开新会话，不依赖成功终态——
    //    本机 Windows 轮询上屏成功态有既有环境问题，见 PROGRESS.md 已知风险）
    await aside.getByRole("button", { name: "新建生成" }).click();
    await page.waitForURL("**/");
    await page.locator("textarea").first().fill("第二张测试图");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => harness.requests.length).toBe(2);
    await expect(aside.locator("[data-conv-row]").nth(0).getByText("第二张测试图")).toBeVisible();
    await expect(aside.locator("[data-conv-row]").nth(1).getByText("项目归属测试图")).toBeVisible();

    // ⑤ hover 项目行点 +：居中弹窗新建项目，保存后出现在列表首部
    await aside.getByText("默认项目").hover();
    await aside.getByLabel("新建项目").first().click();
    await page.getByRole("dialog", { name: "新建项目" }).locator("input").fill("工作项目");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(aside.getByText("工作项目")).toBeVisible();
    await expect(aside.locator("[data-project-row]").nth(0).getByText("工作项目")).toBeVisible();

    // ⑥ hover 点 … → 重命名项目：弹窗预填旧名，保存生效
    await aside.getByText("工作项目").hover();
    await aside.getByLabel("项目更多操作：工作项目").click();
    await expect(aside.getByText("重命名项目")).toBeVisible(); // 下拉已展开
    await aside.getByText("重命名项目").click();
    const renameInput = page.getByRole("dialog", { name: "重命名项目" }).locator("input");
    await expect(renameInput).toHaveValue("工作项目");
    await renameInput.fill("副业项目");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(aside.getByText("副业项目")).toBeVisible();

    // ⑦ 项目内会话长按拖动：把「项目归属测试图」拖到第一位
    const convRows = aside.locator("[data-conv-row]");
    const source = convRows.nth(1);
    const target = convRows.nth(0);
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    test.skip(!sourceBox || !targetBox, "会话行不可见，无法拖动");
    await page.mouse.move(sourceBox!.x + 20, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450); // 超过 350ms 长按阈值
    await page.mouse.move(targetBox!.x + 20, targetBox!.y + 2, { steps: 8 });
    await page.mouse.up();
    await expect(aside.locator("[data-conv-row]").nth(0).getByText("项目归属测试图")).toBeVisible();

    // ⑧ 项目长按拖动：把「默认项目」拖到「副业项目」之上
    const defaultRow = aside.locator("[data-project-row]", { hasText: "默认项目" });
    const sideRow = aside.locator("[data-project-row]", { hasText: "副业项目" });
    const defaultBox = await defaultRow.boundingBox();
    const sideBox = await sideRow.boundingBox();
    test.skip(!defaultBox || !sideBox, "项目行不可见，无法拖动");
    await page.mouse.move(defaultBox!.x + 20, defaultBox!.y + defaultBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.move(sideBox!.x + 20, sideBox!.y + 2, { steps: 8 });
    await page.mouse.up();
    await expect(aside.locator("[data-project-row]").nth(0).getByText("默认项目")).toBeVisible();

    // ⑨ 刷新：项目名、顺序、会话顺序全部保持（服务端持久化）
    await page.reload();
    await expect(aside.getByText("副业项目")).toBeVisible();
    await expect(aside.locator("[data-project-row]").nth(0).getByText("默认项目")).toBeVisible();
    await expect(aside.locator("[data-conv-row]").nth(0).getByText("项目归属测试图")).toBeVisible();
    await expect(aside.locator("[data-conv-row]").nth(1).getByText("第二张测试图")).toBeVisible();
  });
});
