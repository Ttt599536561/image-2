// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("site favicon", () => {
  it("references the versioned SVG favicon from the document head", () => {
    const root = readFileSync(join(process.cwd(), "app/root.tsx"), "utf8");

    expect(root).toContain(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=1" />',
    );
  });

  it("ships the supplied SVG artwork", () => {
    const faviconPath = join(process.cwd(), "public/favicon.svg");

    expect(existsSync(faviconPath), "public/favicon.svg should exist").toBe(true);
    if (!existsSync(faviconPath)) return;

    const favicon = readFileSync(faviconPath, "utf8");
    expect(favicon).toContain('viewBox="0 0 1024 1024"');
    expect(favicon).toContain('fill="#66B3FE"');
    expect(favicon).toContain('fill="#F44444"');
  });
});
