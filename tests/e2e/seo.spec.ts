import { expect, test } from "@playwright/test";

// Search and help content must be useful without executing JavaScript or
// creating an anonymous generation session.
test.use({ javaScriptEnabled: false });

test("public pages expose complete server-rendered search metadata", async ({ request, baseURL }) => {
  for (const path of ["/", "/guide"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toMatch(/name="description" content="[^"]+"/);
    expect(html).toContain(`href="${baseURL}${path}"`);
    expect(html).toContain('rel="canonical"');
    expect(html).not.toMatch(/name="robots" content="noindex/);
    expect(html).toContain('property="og:image"');
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
  }
  const home = await (await request.get("/")).text();
  expect(home).toContain('href="/guide"');
  expect(home).toContain('application/ld+json');
  expect(home).not.toContain("使用自己的图片服务 URL");
});

test("discovery files list only public canonical pages and private pages stay excluded", async ({ request, baseURL }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml.match(/<loc>/g)).toHaveLength(2);
  expect(xml).toContain(`<loc>${baseURL}/</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/guide</loc>`);
  const admin = await request.get("/admin/login");
  expect(admin.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(await admin.text()).toMatch(/name="robots" content="noindex/);
  expect((await request.get("/this-page-does-not-exist")).status()).toBe(404);
  const legacy = await request.get("/welcome", { maxRedirects: 0 });
  expect(legacy.status()).toBe(301);
  expect(legacy.headers().location).toBe("/");
  const card = await request.get("/og-image.png");
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toContain("image/png");
});

test("guide is readable without JavaScript on desktop and mobile", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /工作台/ }).first()).toBeVisible();
  await expect(page.locator("body")).toContainText("API Key");
  await page.screenshot({ path: ".cache/logs/seo-guide-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".cache/logs/seo-guide-mobile.png" });
});
