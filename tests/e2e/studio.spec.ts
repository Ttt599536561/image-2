import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { completeJob, configureConnection, expect, expectNoMoney, firstSseStatus, fixtureBaseUrl, fixtureKey, history, openStudio, ownerOf, pool, postJob, referenceFiles, requestBody, selectOption, submitFromUi, test, tinyPng } from "./studio-fixture";

const references = (page: Page) => page.getByRole("img", { name: /^参考图片 \d$/ });
const modelSelect = (page: Page) => page.getByRole("combobox", { name: "生成模型", exact: true });

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
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveValue(fixtureBaseUrl);
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveAttribute("readonly", "");
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
  await selectOption(page, "生成质量", "高");
  await selectOption(page, "图片背景", "不透明");
  const prompt = "清晨的橙色纸船，蓝色天空";
  const accepted = await submitFromUi(page, prompt);
  await expect.poll(async () => (await history(page))[0]?.status).toBe("queued");
  await page.reload();
  await expect(page.getByRole("heading", { name: "任务已提交", exact: true })).toBeVisible();
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
  await expect(page.getByRole("combobox", { name: "生成质量" })).toContainText("高");
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
  await expect(references(page)).toHaveCount(1);
  const first = await submitFromUi(page, "参考图换成水彩风格");
  const initial = (await pool.query("SELECT input_image_key,input_image_keys FROM generations WHERE id=$1", [first.generationId])).rows[0];
  expect((initial.input_image_keys ?? [initial.input_image_key])[0]).toMatch(new RegExp(`^uploads/${owner}/`));
  await completeJob(first.generationId, { reference: true });
  await expect(page.getByRole("button", { name: "以图编辑" })).toBeVisible();
  await page.getByRole("button", { name: "以图编辑" }).click();
  await expect(references(page)).toHaveCount(1);
  const second = await submitFromUi(page, "保留构图，添加落日");
  await completeJob(second.generationId, { reference: true, prompt: "保留构图，添加落日" });
  await expect.poll(async () => (await history(page)).filter((entry) => entry.blobSize > 0).length).toBe(2);
  await expectNoMoney(owner);
});

test("submitted task is visible before reference uploads finish and completes with the same ID", async ({ page }, testInfo) => {
  const owner = await openStudio(page);
  await configureConnection(page);
  await selectOption(page, "生成模型", "gpt-image-2.5-sunburst");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  await expect(references(page)).toHaveCount(4);
  const prompt = "后台上传四张参考图，任务立即可见";
  let releaseUploads!: () => void;
  const heldUploads = new Promise<void>((resolve) => { releaseUploads = resolve; });
  let uploadCalls = 0;
  const generationRequests: Record<string, unknown>[] = [];
  await page.route("**/api/studio/uploads", async (route) => {
    uploadCalls += 1;
    await heldUploads;
    await route.continue();
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/studio/generate") generationRequests.push(request.postDataJSON());
  });
  await page.getByLabel("画面描述").fill(prompt);
  await page.getByRole("button", { name: "开始生成" }).click();
  let generationId = "";
  try {
    await expect.poll(() => uploadCalls).toBe(1);
    await expect(page.getByRole("heading", { name: "任务已提交", exact: true })).toBeVisible({ timeout: 3_000 });
    const card = page.getByRole("region", { name: "生成结果" }).getByRole("button", { name: new RegExp(`：${prompt}$`) });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/上传中|上传并提交中/)).toHaveCount(0);
    await expect.poll(async () => (await history(page)).length).toBe(1);
    const localTask = (await history(page))[0];
    generationId = localTask.generationId;
    expect(localTask.status).toBe("queued");
    expect(localTask.snapshot).not.toMatch(/apiKey|fixture-key|fixture-1|baseUrl/);
    expect(generationRequests).toHaveLength(0);
    expect((await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rowCount).toBe(0);
    await testInfo.attach("submitted-before-upload", { body: await page.screenshot({ path: testInfo.outputPath("immediate-submitted-desktop.png") }), contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "任务已提交", exact: true })).toBeInViewport();
    await testInfo.attach("submitted-before-upload-mobile", { body: await page.screenshot({ path: testInfo.outputPath("immediate-submitted-mobile.png") }), contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 720 });
  } finally { releaseUploads(); }
  await expect.poll(() => generationRequests.length).toBe(1);
  expect(generationRequests[0].generationId).toBe(generationId);
  expect(generationRequests[0].inputImageKeys).toHaveLength(4);
  await expect.poll(async () => (await pool.query("SELECT id FROM generations WHERE id=$1", [generationId])).rowCount).toBe(1);
  await completeJob(generationId, { model: "gpt-image-2.5-sunburst", images: referenceFiles.slice(0, 4).map((file) => file.buffer), prompt });
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  await expect(page.getByRole("button", { name: `已完成：${prompt}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await history(page)).map(({ generationId: id, status }) => ({ id, status }))).toEqual([{ id: generationId, status: "succeeded" }]);
  expect(uploadCalls).toBe(4);
  expect(generationRequests).toHaveLength(1);
  await expectNoMoney(owner);
});

test("failed reference upload keeps its task and retries the original ID with every reference in order", async ({ page }, testInfo) => {
  const owner = await openStudio(page);
  await configureConnection(page);
  await selectOption(page, "生成模型", "gpt-image-2.5-sunburst");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  await expect(references(page)).toHaveCount(4);
  const prompt = "第二张上传失败后重试原来的四图任务";
  let uploadCalls = 0;
  const generationRequests: Record<string, unknown>[] = [];
  await page.route("**/api/studio/uploads", async (route) => {
    uploadCalls += 1;
    if (uploadCalls === 2) await route.fulfill({ status: 408, contentType: "application/json", body: JSON.stringify({ error: "参考图片请求超时，请重试。" }) });
    else await route.continue();
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/studio/generate") generationRequests.push(request.postDataJSON());
  });
  await page.getByLabel("画面描述").fill(prompt);
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("heading", { name: "这次生成未能完成" })).toBeVisible();
  await expect(page.getByRole("button", { name: `生成失败：${prompt}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "重试任务", exact: true })).toBeEnabled();
  await expect.poll(async () => (await history(page)).map((entry) => entry.status)).toEqual(["failed"]);
  const generationId = (await history(page))[0].generationId;
  expect(uploadCalls).toBe(2);
  expect(generationRequests).toHaveLength(0);
  expect((await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rowCount).toBe(0);
  await testInfo.attach("failed-upload-task", { body: await page.screenshot({ path: testInfo.outputPath("failed-upload-task.png") }), contentType: "image/png" });
  // New form edits and a different Key must not change the failed task's in-memory snapshot.
  await selectOption(page, "生成模型", "gpt-image-2");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles[4]);
  await expect(references(page)).toHaveCount(1);
  await page.getByLabel("画面描述").fill("新表单与原任务无关");
  await page.getByRole("navigation").getByRole("button", { name: "连接设置", exact: true }).click();
  await page.getByPlaceholder("输入你的 API Key").fill("replacement-fixture-key-must-not-reach-relay");
  await page.getByRole("button", { name: "完成，开始创作" }).click();
  await page.getByRole("button", { name: "重试任务", exact: true }).click();
  await expect.poll(() => generationRequests.length).toBe(1);
  expect(generationRequests[0]).toMatchObject({ generationId, prompt, model: "gpt-image-2.5-sunburst", apiKey: fixtureKey });
  expect(generationRequests[0].inputImageKeys).toHaveLength(4);
  expect(generationRequests[0].inputImageKey).toBeUndefined();
  await expect.poll(async () => (await pool.query("SELECT id FROM generations WHERE id=$1", [generationId])).rowCount).toBe(1);
  await completeJob(generationId, { model: "gpt-image-2.5-sunburst", images: referenceFiles.slice(0, 4).map((file) => file.buffer), prompt });
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  await expect(page.getByRole("button", { name: `已完成：${prompt}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await history(page)).map(({ generationId: id, status }) => ({ id, status }))).toEqual([{ id: generationId, status: "succeeded" }]);
  expect((await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rows).toEqual([{ id: generationId }]);
  expect(generationRequests).toHaveLength(1);
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
    expect((await postJob(other, requestBody({ inputImageKeys: [inputImageKey] }))).status()).toBe(400);
    const otherUpload = await other.request.post("/api/studio/uploads", { multipart: { file: referenceFiles[0] }, headers: { origin: new URL(other.url()).origin } });
    expect(otherUpload.status()).toBe(200);
    const ownKey = (await otherUpload.json()).inputImageKey;
    expect((await postJob(other, requestBody({ inputImageKeys: [ownKey, ownKey, inputImageKey, ownKey] }))).status()).toBe(400);
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
  for (const extra of [{ credentialMode: "system" }, { ownerId: randomUUID() }, { userId: randomUUID() }, { baseUrl: "https://forged.example/v1" }, { model: "gpt-image-1" }]) {
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
  await selectOption(page, "生成模型", "gpt-image-2.5-sunburst");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  await expect(references(page)).toHaveCount(4);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/studio/generate", async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await route.abort("connectionreset"); else await route.continue();
  });
  await page.getByLabel("画面描述").fill("网络中断恢复测试");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("button", { name: "确认并重试" })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].model).toBe("gpt-image-2.5-sunburst");
  expect(requests[0].inputImageKeys).toHaveLength(4);
  await expect(page.getByRole("alert")).toContainText("网络中断");
  // Changes made after an uncertain submission cannot alter its frozen retry payload.
  await selectOption(page, "生成模型", "gpt-image-2");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  await expect(references(page)).toHaveCount(4);
  await page.getByRole("button", { name: "移除参考图片 2", exact: true }).click();
  await page.getByLabel("画面描述").fill("这段修改不应进入重试任务");
  await page.getByRole("button", { name: "确认并重试" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  const generationId = String(requests[0].generationId);
  await expect.poll(async () => (await pool.query("SELECT id FROM generations WHERE id=$1", [generationId])).rowCount).toBe(1);
  await completeJob(generationId, { model: "gpt-image-2.5-sunburst", images: referenceFiles.slice(0, 4).map((file) => file.buffer), prompt: "网络中断恢复测试" });
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
  await expect(page.getByRole("button", { name: "正在处理…" })).toBeDisabled();
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
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "显示 API Key", exact: true }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveAttribute("type", "text");
  await fits();
  await page.getByRole("button", { name: "完成，开始创作" }).click();
  await fits();
});

test("fixed service ignores legacy browser URLs and both models reach the fake relay with saved snapshots", async ({ page }) => {
  const foreignKey = "fixture-legacy-key-bound-to-another-service";
  await page.addInitScript(({ key }) => localStorage.setItem("image-studio-connection-v1", JSON.stringify({
    baseUrl: "https://obsolete-browser-setting.example/v1", apiKey: key, rememberKey: true,
  })), { key: foreignKey });
  const generationRequests: Record<string, unknown>[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/studio/generate") generationRequests.push(request.postDataJSON()); });
  const owner = await openStudio(page);
  await page.getByRole("navigation").getByRole("button", { name: "连接设置", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveValue(fixtureBaseUrl);
  await expect(page.locator('input[type="url"]')).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /URL|地址/i })).toHaveAttribute("readonly", "");
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: /在此浏览器记住 API Key/ })).not.toBeChecked();
  await page.getByRole("button", { name: "完成，开始创作" }).click();
  await page.getByLabel("画面描述").fill("旧连接的密钥不能发送到新地址");
  await page.getByRole("button", { name: "连接服务后开始" }).click();
  await expect(page.getByPlaceholder("输入你的 API Key")).toHaveValue("");
  expect(generationRequests).toHaveLength(0);
  await page.getByPlaceholder("输入你的 API Key").fill(fixtureKey);
  await page.getByRole("button", { name: "完成，开始创作" }).click();
  await expect(modelSelect(page)).toContainText("gpt-image-2");
  for (const model of ["gpt-image-2", "gpt-image-2.5-sunburst"] as const) {
    await selectOption(page, "生成模型", model);
    const request = page.waitForRequest((item) => new URL(item.url()).pathname === "/api/studio/generate");
    const accepted = await submitFromUi(page, `${model} 模型快照`);
    const payload = (await request).postDataJSON();
    expect(payload.model).toBe(model);
    expect(payload.baseUrl === undefined || payload.baseUrl === fixtureBaseUrl).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("obsolete-browser-setting");
    expect(payload.apiKey).toBe(fixtureKey);
    expect(JSON.stringify(payload)).not.toContain(foreignKey);
    const stored = (await pool.query("SELECT model FROM generations WHERE id=$1", [accepted.generationId])).rows[0];
    expect(stored.model).toBe(model);
    await completeJob(accepted.generationId, { model });
    await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
    await expect.poll(async () => (await history(page)).find((entry) => entry.generationId === accepted.generationId)?.blobSize).toBe(tinyPng.length);
    expect(JSON.parse((await history(page)).find((entry) => entry.generationId === accepted.generationId)!.snapshot).params.model).toBe(model);
    await selectOption(page, "生成模型", model === "gpt-image-2" ? "gpt-image-2.5-sunburst" : "gpt-image-2");
    await page.getByRole("button", { name: "复用参数" }).click();
    await expect(modelSelect(page)).toHaveText(model);
  }
  expect(generationRequests).toHaveLength(2);
  expect(JSON.stringify(generationRequests)).not.toContain(foreignKey);
  await expectNoMoney(owner);
});

test("four references keep byte order; fifth is refused and removing the middle permits an append", async ({ page }) => {
  const owner = await openStudio(page);
  await configureConnection(page);
  await selectOption(page, "生成模型", "gpt-image-2.5-sunburst");
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 2));
  for (const [index, method] of [[2, "drop"], [3, "paste"]] as const) {
    const file = referenceFiles[index];
    const transfer = await page.evaluateHandle(({ name, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }));
      return data;
    }, { name: file.name, bytes: Array.from(file.buffer) });
    if (method === "drop") await page.getByLabel("上传参考图片").locator("..").dispatchEvent("drop", { dataTransfer: transfer });
    else await page.getByLabel("画面描述").evaluate((element, clipboardData) => element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData })), transfer);
    await transfer.dispose();
  }
  await expect(references(page)).toHaveCount(4);
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles[4]);
  await expect(page.getByText(/最多.*4.*参考|参考.*最多.*4/).last()).toBeVisible();
  await expect(references(page)).toHaveCount(4);
  await page.getByRole("button", { name: "移除参考图片 2", exact: true }).click();
  await expect(references(page)).toHaveCount(3);
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles[4]);
  await expect(references(page)).toHaveCount(4);
  const request = page.waitForRequest((item) => new URL(item.url()).pathname === "/api/studio/generate");
  const accepted = await submitFromUi(page, "四张参考图按顺序融合");
  const payload = (await request).postDataJSON();
  expect(payload.inputImageKeys).toHaveLength(4);
  expect(payload.inputImageKey).toBeUndefined();
  const stored = (await pool.query("SELECT model,input_image_key,input_image_keys FROM generations WHERE id=$1", [accepted.generationId])).rows[0];
  expect(stored.model).toBe("gpt-image-2.5-sunburst");
  expect(stored.input_image_keys).toEqual(payload.inputImageKeys);
  expect(stored.input_image_key).toBeNull();
  for (const key of payload.inputImageKeys) expect(key).toMatch(new RegExp(`^uploads/${owner}/`));
  await completeJob(accepted.generationId, { model: "gpt-image-2.5-sunburst", images: [0, 2, 3, 4].map((index) => referenceFiles[index].buffer) });
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  const before = (await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rowCount;
  expect((await postJob(page, requestBody({ inputImageKeys: [...payload.inputImageKeys, payload.inputImageKeys[0]] }))).status()).toBe(400);
  expect((await postJob(page, requestBody({ inputImageKey: payload.inputImageKeys[0], inputImageKeys: payload.inputImageKeys }))).status()).toBe(400);
  expect((await postJob(page, requestBody({ sourceImageId: randomUUID(), inputImageKeys: payload.inputImageKeys }))).status()).toBe(400);
  expect((await pool.query("SELECT id FROM generations WHERE user_id=$1", [owner])).rowCount).toBe(before);
  await expectNoMoney(owner);
});

test("legacy single-image API and browser history without a model use gpt-image-2", async ({ page }) => {
  await openStudio(page);
  await configureConnection(page, true);
  const upload = await page.request.post("/api/studio/uploads", { multipart: { file: { name: "legacy.png", mimeType: "image/png", buffer: tinyPng } }, headers: { origin: new URL(page.url()).origin } });
  expect(upload.status()).toBe(200);
  const payload = requestBody({ inputImageKey: (await upload.json()).inputImageKey });
  expect(payload.model).toBeUndefined();
  expect((await postJob(page, payload)).status()).toBe(202);
  await completeJob(payload.generationId, { reference: true });
  const accepted = await submitFromUi(page, "旧版历史没有模型字段");
  await completeJob(accepted.generationId);
  await expect.poll(async () => (await history(page))[0]?.blobSize).toBe(tinyPng.length);
  await page.evaluate((id) => new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open("image-studio-history", 1);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const db = opened.result;
      const transaction = db.transaction("generations", "readwrite");
      const store = transaction.objectStore("generations");
      const request = store.get(id);
      request.onsuccess = () => { const entry = request.result; delete entry.params.model; store.put(entry); };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), accepted.generationId);
  await page.reload();
  await expect(page.getByRole("button", { name: "放大查看生成图片" })).toBeVisible();
  await selectOption(page, "生成模型", "gpt-image-2.5-sunburst");
  await page.getByRole("button", { name: "复用参数" }).click();
  await expect(modelSelect(page)).toHaveText("gpt-image-2");
  await expect(page.getByLabel("画面描述")).toHaveValue("旧版历史没有模型字段");
});

async function fullyVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
}

test("all desktop controls and four references fit without clipped or internally scrolling panels", async ({ page }, testInfo) => {
  await openStudio(page);
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  await page.getByLabel("画面描述").fill("桌面四图与全部常用控件同屏验收");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "切换到深色主题" }).click();
    for (const viewport of [{ width: 1366, height: 700 }, { width: 1366, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      const panel = page.locator("#studio-creation-panel");
      const panelGeometry = await panel.evaluate((element) => [element, ...element.querySelectorAll('[class*="panelScroll"]')].map((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })));
      await testInfo.attach(`desktop-${viewport.width}x${viewport.height}-${theme}-geometry`, { body: JSON.stringify(panelGeometry, null, 2), contentType: "application/json" });
      for (const bounds of panelGeometry) expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight);
      for (const locator of [page.getByLabel("画面描述"), modelSelect(page), page.getByRole("combobox", { name: "生成质量" }), page.getByRole("combobox", { name: "图片背景" }), page.getByRole("button", { name: "连接服务后开始" })]) await fullyVisible(locator);
      await expect(references(page)).toHaveCount(4);
      for (const reference of await references(page).all()) await fullyVisible(reference);
      for (const remove of await page.getByRole("button", { name: /^移除参考图片 \d$/ }).all()) await fullyVisible(remove);
      for (const ratio of await panel.locator("fieldset button").all()) await fullyVisible(ratio);
      const screenshot = await page.screenshot({ path: testInfo.outputPath(`desktop-${viewport.width}x${viewport.height}-${theme}.png`), fullPage: true });
      await testInfo.attach(`desktop-${viewport.width}x${viewport.height}-${theme}`, { body: screenshot, contentType: "image/png" });
    }
  }
  await page.setViewportSize({ width: 1366, height: 600 });
  const shortLayout = await page.locator("#studio-creation-panel").evaluate((element) => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    panels: [element, ...element.querySelectorAll('[class*="panelScroll"]')].map((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflow: getComputedStyle(node).overflowY })),
  }));
  expect(shortLayout.documentHeight).toBeGreaterThan(shortLayout.viewportHeight);
  for (const panel of shortLayout.panels) {
    expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight);
    expect(panel.overflow).not.toMatch(/auto|scroll|hidden|clip/);
  }
  for (const control of [modelSelect(page), page.getByLabel("画面描述"), page.getByRole("combobox", { name: "生成质量" }), page.getByRole("combobox", { name: "图片背景" }), page.getByRole("button", { name: "连接服务后开始" })]) {
    await control.scrollIntoViewIfNeeded();
    await fullyVisible(control);
  }
  const screenshot = await page.screenshot({ path: testInfo.outputPath("desktop-1366x600-page-scroll.png"), fullPage: true });
  await testInfo.attach("desktop-1366x600-page-scroll", { body: screenshot, contentType: "image/png" });
});

test("custom selectors support arrows, Enter, Escape, Tab and keep their popups in the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openStudio(page);
  for (const { label, choice } of [{ label: "生成模型", choice: "gpt-image-2.5-sunburst" }, { label: "生成质量", choice: "高" }, { label: "图片背景", choice: "透明" }]) {
    const trigger = page.getByRole("combobox", { name: label, exact: true });
    const before = await trigger.innerText();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: label, exact: true });
    await expect(list).toBeFocused();
    await fullyVisible(list);
    await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText(choice);
    expect(await trigger.innerText()).not.toBe(before);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveText(choice);
    await trigger.click();
    await page.keyboard.press("Tab");
    await expect(list).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
    await trigger.click();
    await page.getByRole("heading", { name: "让想法成像" }).click();
    await expect(list).toHaveCount(0);
    await page.getByLabel("画面描述").click();
    await expect(page.getByLabel("画面描述")).toBeFocused();
  }
  await page.getByLabel("上传参考图片").setInputFiles(referenceFiles.slice(0, 4));
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.viewport);
    for (const label of ["生成模型", "生成质量", "图片背景"]) {
      const trigger = page.getByRole("combobox", { name: label, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await fullyVisible(page.getByRole("listbox", { name: label, exact: true }));
      await page.keyboard.press("Escape");
    }
    for (const reference of await references(page).all()) { await reference.scrollIntoViewIfNeeded(); await fullyVisible(reference); }
    const button = page.getByRole("button", { name: "连接服务后开始" });
    await button.scrollIntoViewIfNeeded();
    await fullyVisible(button);
    const screenshot = await page.screenshot({ path: testInfo.outputPath(`mobile-${viewport.width}x${viewport.height}-four-references.png`), fullPage: true });
    await testInfo.attach(`mobile-${viewport.width}x${viewport.height}-four-references`, { body: screenshot, contentType: "image/png" });
  }
});
