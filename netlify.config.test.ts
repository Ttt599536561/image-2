// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "toml";
import { describe, expect, it } from "vitest";
import routes from "./app/routes";
import { shouldUseNetlifyReactRouter } from "./vite.config";

describe("local Netlify API routing", () => {
  it("disables the deploy adapter only for disposable test runtimes", () => {
    expect(shouldUseNetlifyReactRouter({ DISPOSABLE_TEST_DB_DRIVER: "pg" })).toBe(false);
    expect(shouldUseNetlifyReactRouter({})).toBe(true);
  });

  it("forces generation rewrites ahead of the framework SSR catch-all", () => {
    const config = parse(readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8")) as {
      redirects?: Array<{ from?: string; to?: string; status?: number; force?: boolean }>;
    };
    const redirects = config.redirects ?? [];

    for (const path of ["/api/generate", "/api/generate-status"]) {
      const rule = redirects.find((redirect) => redirect.from === path);
      expect(rule).toMatchObject({
        from: path,
        status: 200,
        force: true,
      });
    }
  });

  it("registers local resource routes for the full generation lifecycle", () => {
    const directRoutes = routes as Array<{ file?: string; path?: string }>;

    expect(directRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "api/generate", file: "routes/api.generate.ts" }),
        expect.objectContaining({
          path: "api/generate-background",
          file: "routes/api.generate-background.ts",
        }),
        expect.objectContaining({
          path: "api/generate-status",
          file: "routes/api.generate-status.ts",
        }),
      ]),
    );
  });
});
