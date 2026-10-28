import { randomUUID } from "node:crypto";
import { completeJob, configureConnection, expect, expectNoMoney, firstSseStatus, fixtureBaseUrl, fixtureKey, history, openStudio, ownerOf, pool, postJob, requestBody, submitFromUi, test, tinyPng } from "./studio-fixture";

test("@smoke anonymous entry and explicit key retention", async ({ page }) => {
  const owner = await openStudio(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "从一个想法开始" })).toBeVisible();
  await expect(page.getByRole("link", { name: /登录|注册|套餐|积分|充值/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /登录|注册|套餐|充值/ })).toHaveCount(0);
  await configureConnection(page);
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).toContain(fixtureBaseUrl);
  expect(local).not.toContain(fixtureKey);
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "连接设置", exact: true }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue("");
  await expect(page.getByPlaceholder("https://api.tangguo.xin/v1")).toHaveValue(fixtureBaseUrl);
  await page.getByPlaceholder("输入你的 API Key").fill(fixtureKey);
  await page.getByRole("checkbox", { name: /在此浏览器记住 API Key/ }).check();
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "连接设置", exact: true }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue(fixtureKey);
  await page.getByRole("checkbox", { name: /在此浏览器记住 API Key/ }).uncheck();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(fixtureKey);
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue(fixtureKey);
  await page.getByRole("button", { name: "清除 API Key" }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue("");
  expect(await ownerOf(page.context())).toBe(owner);
  await expectNoMoney(owner);
});

test("@smoke real queue, refresh recovery, SSE, local Blob, preview, download, reuse and clear", async ({ page }) => {
  const owner = await openStudio(page);
  await configureConnection(page, true);
  await page.getByRole("button", { name: "3:2 1536 × 1024" }).click();
  await page.getByLabel("生成质量").selectOption("high");
  await page.getByText("更多选项", { exact: true }).click();
  await page.getByLabel("图片背景").selectOption("opaque");
  const prompt = "清晨的橙色纸船，蓝色天空";
  const accepted = await submitFromUi(page, prompt);
  await expect.poll(async () => (await history(page))[0]?.status).toBe("queued");
  await page.reload();
  await expect(page.getByRole("heading", { name: "灵感已就位，等待生成" })).toBeVisible();
  expect((await firstSseStatus(page, accepted.generationId)).items[0].status).toBe("queued");
  // Disable only recovery polling after its initial queued snapshot. Completion must arrive over real SSE.
  await page.route("**/api/studio/status?*", (route) => route.abort("failed"));
  await completeJob(accepted.generationId, { prompt });
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await history(page))[0]?.blobSize).toBe(tinyPng.length);
  const saved = (await history(page))[0];
  expect(saved.blobType).toBe("image/png");
  expect(saved.snapshot).not.toMatch(/apiKey|baseUrl|fixture-key/);
  await page.getByRole("button", { name: "放大查看生成图片" }).click();
  await expect(page.getByRole("dialog", { name: "图片放大预览" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原图" }).click();
  expect((await download).suggestedFilename()).toContain(accepted.generationId);
  await page.getByRole("button", { name: "复用参数" }).click();
  await expect(page.getByLabel("画面描述")).toHaveValue(prompt);
  await expect(page.getByRole("button", { name: "3:2 1536 × 1024" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("生成质量")).toHaveValue("high");
  // Completed history renders its saved Blob after reload even if server media is unavailable.
  await page.route("**/api/studio/images/*", (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByRole("button", { name: "放大查看生成图片" }).locator("img")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("navigation").getByRole("button", { name: "此设备历史" }).click();
  await expect(page.getByRole("img", { name: prompt })).toBeVisible();
  await page.getByRole("button", { name: "清空历史", exact: true }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("heading", { name: "这里等待你的第一张作品" })).toBeVisible();
  await expect.poll(async () => (await history(page)).length).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toContain(fixtureKey);
  await expectNoMoney(owner);
});

test("reference upload and editing a completed image use real stored bytes", async ({ page }) => {
  const owner = await openStudio(page);
  await configureConnection(page);
  await page.getByLabel("上传参考图片").setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.getByRole("img", { name: "参考图片预览" })).toBeVisible();
  const first = await submitFromUi(page, "参考图换成水彩风格");
  const initial = (await pool.query("SELECT input_image_key FROM generations WHERE id=$1", [first.generationId])).rows[0];
  expect(initial.input_image_key).toMatch(new RegExp(`^uploads/${owner}/`));
  await completeJob(first.generationId, { reference: true });
  await expect(page.getByRole("button", { name: "以图编辑" })).toBeVisible();
  await page.getByRole("button", { name: "以图编辑" }).click();
  await expect(page.getByRole("img", { name: "参考图片预览" })).toBeVisible();
  const second = await submitFromUi(page, "保留构图，添加落日");
  await completeJob(second.generationId, { reference: true, prompt: "保留构图，添加落日" });
  await expect.poll(async () => (await history(page)).filter((entry) => entry.blobSize > 0).length).toBe(2);
  await expectNoMoney(owner);
});

test("two browser contexts cannot read, subscribe to, or reuse each other's jobs and media", async ({ page, browser }) => {
  const owner = await openStudio(page);
  const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await second.newPage();
  try {
    const otherOwner = await openStudio(other);
    expect(otherOwner).not.toBe(owner);
    const payload = requestBody();
    const accepted = await postJob(page, payload);
    expect(accepted.status()).toBe(202);
    await completeJob(payload.generationId);
    const status = await (await page.request.get(`/api/studio/status?ids=${payload.generationId}`)).json();
    const image = status.items[0].image;
    expect(status.items[0].status).toBe("succeeded");
    const isolated = await (await other.request.get(`/api/studio/status?ids=${payload.generationId}`)).json();
    expect(isolated).toEqual({ items: [], missingIds: [payload.generationId] });
    expect(await firstSseStatus(other, payload.generationId)).toEqual(isolated);
    expect((await page.request.get(image.url)).status()).toBe(200);
    expect((await other.request.get(image.url)).status()).toBe(404);
    const stored = (await pool.query("SELECT storage_key FROM images WHERE generation_id=$1", [payload.generationId])).rows[0];
    expect((await other.request.get(`/media/${stored.storage_key}`)).status()).toBe(404);
    const upload = await page.request.post("/api/studio/uploads", { multipart: { file: { name: "private.png", mimeType: "image/png", buffer: tinyPng } }, headers: { origin: new URL(page.url()).origin } });
    expect(upload.status()).toBe(200);
    const { inputImageKey } = await upload.json();
    expect((await page.request.get(`/media/${inputImageKey}`)).status()).toBe(200);
    expect((await other.request.get(`/media/${inputImageKey}`)).status()).toBe(404);
    expect((await postJob(other, requestBody({ inputImageKey }))).status()).toBe(400);
    expect((await postJob(other, requestBody({ sourceImageId: image.id, conversationId: (await accepted.json()).conversationId }))).status()).toBe(404);
    expect((await postJob(other, payload)).status()).toBe(404);
    expect(await history(other)).toEqual([]);
    await expectNoMoney(owner);
    await expectNoMoney(otherOwner);
  } finally { await second.close(); }
});

test("retired public APIs and forged system/owner fields cannot create jobs or balances", async ({ page }) => {
  const owner = await openStudio(page);
  for (const path of ["/api/auth/sign-up/email", "/api/redeem", "/api/generate", "/api/generate-status", "/api/generate-events", "/api/balance", "/api/key-settings"]) {
    expect((await page.request.post(path, { data: {}, headers: { origin: new URL(page.url()).origin } })).status(), path).toBe(404);
  }
  for (const extra of [{ credentialMode: "system" }, { ownerId: randomUUID() }, { userId: randomUUID() }]) {
    expect((await postJob(page, { ...requestBody(), ...extra })).status()).toBe(400);
  }
  const wrongOrigin = await page.request.post("/api/studio/generate", { data: requestBody(), headers: { origin: "https://other.example" } });
  expect(wrongOrigin.status()).toBe(403);
  expect((await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rowCount).toBe(0);
  await expectNoMoney(owner);
  for (const path of ["/register", "/login", "/billing"]) { await page.goto(path); await expect(page).toHaveURL(/\/$/); }
});

test("network uncertainty retries only on request with the same generation ID", async ({ page }) => {
  await openStudio(page);
  await configureConnection(page);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/studio/generate", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await route.abort("connectionreset"); else await route.continue();
  });
  await page.getByLabel("画面描述").fill("网络中断恢复测试");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("button", { name: "确认并重试" })).toBeVisible();
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("alert")).toContainText("网络中断");
  await page.getByRole("button", { name: "确认并重试" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  const generationId = String(requests[0].generationId);
  await expect.poll(async () => (await pool.query("SELECT id FROM generations WHERE id=$1", [generationId])).rowCount).toBe(1);
  await completeJob(generationId);
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  expect(requests).toHaveLength(2);
});

test("slow submissions block duplicates; Enter edits, Ctrl+Enter submits, IME does not", async ({ page }) => {
  await openStudio(page);
  await configureConnection(page);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  let generationId = "";
  await page.route("**/api/studio/generate", async (route) => { calls += 1; generationId = route.request().postDataJSON().generationId; await hold; await route.continue(); });
  const prompt = page.getByLabel("画面描述");
  await prompt.fill("第一行");
  await prompt.press("End");
  await prompt.press("Enter");
  await prompt.pressSequentially("第二行");
  await expect(prompt).toHaveValue("第一行\n第二行");
  await prompt.dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  expect(calls).toBe(0);
  await prompt.press("Control+Enter");
  await expect(page.getByRole("button", { name: "正在提交…" })).toBeDisabled();
  await prompt.press("Control+Enter");
  expect(calls).toBe(1);
  release();
  await expect.poll(async () => (await pool.query("SELECT id FROM generations WHERE id=$1", [generationId])).rowCount).toBe(1);
  await completeJob(generationId);
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  expect(calls).toBe(1);
});

test("failed browser history storage keeps the current result downloadable", async ({ page }) => {
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException("Storage disabled by E2E", "QuotaExceededError"); }; });
  await openStudio(page);
  await expect(page.getByRole("status").filter({ hasText: "此浏览器未能保存历史" })).toBeVisible();
  await configureConnection(page);
  const accepted = await submitFromUi(page, "不可持久化但可下载的作品");
  await completeJob(accepted.generationId);
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原图" }).click();
  expect((await download).suggestedFilename()).toContain(accepted.generationId);
});

test("mobile creation, settings, history and result fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  const fits = async () => {
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("body *")].map((node) => ({ tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 40), right: node.getBoundingClientRect().right, left: node.getBoundingClientRect().left })).filter((node) => node.right > window.innerWidth + 1 || node.left < -1).slice(0, 15),
    }));
    expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  };
  await fits();
  await configureConnection(page);
  await fits();
  const accepted = await submitFromUi(page, "移动端的长描述测试：".repeat(15));
  await completeJob(accepted.generationId);
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  await fits();
  await page.getByRole("navigation").getByRole("button", { name: "此设备历史" }).click();
  await fits();
  await page.setViewportSize({ width: 320, height: 640 });
  await fits();
  await page.getByRole("navigation").getByRole("button", { name: "连接设置", exact: true }).click();
  await fits();
  const downloadButton = page.getByRole("button", { name: "下载原图" });
  await downloadButton.scrollIntoViewIfNeeded();
  const downloadBounds = await downloadButton.boundingBox();
  expect(downloadBounds!.x).toBeGreaterThanOrEqual(0);
  expect(downloadBounds!.x + downloadBounds!.width).toBeLessThanOrEqual(320);
  const mobileDownload = page.waitForEvent("download");
  await downloadButton.click();
  expect((await mobileDownload).suggestedFilename()).toContain(accepted.generationId);
  await page.getByPlaceholder("https://api.tangguo.xin/v1").fill(`https://studio-fixture.example/${"long-path/".repeat(25)}v1`);
  await page.getByRole("button", { name: "显示 API Key", exact: true }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveAttribute("type", "text");
  await fits();
  await page.getByRole("button", { name: "完成，开始创作" }).click();
  await fits();
});
