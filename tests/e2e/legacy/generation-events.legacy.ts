import { expect, test } from "@playwright/test";
import { cleanupTestUsers, closeKeyModeFixture, installGenerationHarness, registerTestUser } from "./key-mode-fixture.legacy";

test.describe.serial("committed generation SSE", () => {
  const emails: string[] = [];
  test.afterEach(async () => { await cleanupTestUsers(emails.splice(0)); });
  test.afterAll(closeKeyModeFixture);

  test("streams a committed image through the real server without status polling or a detail refetch", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeEventSource = window.EventSource;
      (window as any).__generationEvents = [];
      window.EventSource = class extends NativeEventSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          this.addEventListener("status", (event) => {
            (window as any).__generationEvents.push(JSON.parse((event as MessageEvent).data));
          });
        }
      };
    });
    const user = await registerTestUser(page); emails.push(user.email);
    const harness = await installGenerationHarness(page, user.id, { events: true });
    await page.route("**/api/generate-status?*", (route) => route.abort());
    const streamResponse = page.waitForResponse((response) => response.url().includes("/api/generate-events?"));
    await page.locator("textarea").fill("SSE immediate image");
    await page.getByRole("button", { name: "生成", exact: true }).click();
    await expect.poll(() => harness.requests.length).toBe(1);
    const generationId = String(harness.requests[0].generationId);
    const response = await streamResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");
    expect(response.headers()["x-accel-buffering"]).toBe("no");
    await expect.poll(() => page.evaluate((id) => (window as any).__generationEvents.some((event: any) => event.items.some((item: any) => item.generationId === id)), generationId)).toBe(true);
    let detailRequests = 0;
    await page.route("**/api/conversations/*", (route) => { detailRequests += 1; return route.abort(); });
    const started = Date.now();
    await harness.completeSuccess(generationId);
    await expect(page.getByRole("img", { name: "SSE immediate image", exact: true }).first()).toBeVisible({ timeout: 5_000 });
    const elapsedMs = Date.now() - started;
    expect(detailRequests).toBe(0);
    expect(harness.statusRequestCount).toBe(0);
    // Diagnostic measures DB commit + notification + browser DOM; image decoding is tiny fixture only.
    test.info().annotations.push({ type: "commit-to-image-ms", description: String(elapsedMs) });
    console.log(`[generation-events] fixture commit-to-image ${elapsedMs}ms; status polls=0; detail refetches=0`);
    const successful = await page.evaluate((id) => (window as any).__generationEvents.flatMap((event: any) => event.items).find((item: any) => item.generationId === id && item.status === "succeeded"), generationId);
    expect(successful.image.id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(successful.image.savedToLibrary).toBe(false);
    expect(JSON.stringify(successful)).not.toContain("customApiKey");
  });
});
