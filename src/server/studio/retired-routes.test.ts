import { describe, expect, it } from "vitest";
import routes from "../../../app/routes";

function paths(entries: typeof routes): string[] {
  return entries.flatMap((entry) => [entry.path ?? "", ...(entry.children ? paths(entry.children) : [])]);
}

describe("anonymous studio public route boundary", () => {
  it("does not register user authentication, money or legacy generation routes", () => {
    const registered = paths(routes);
    for (const path of ["login", "register", "forgot", "billing", "account", "api/redeem", "api/packages", "api/me", "api/generate", "api/generate-background", "api/admin/codes", "api/admin/packages", "api/admin/config"]) {
      expect(registered, path).not.toContain(path);
    }
  });
  it("exposes only studio generation and guarded administrative maintenance", () => {
    expect(routes).toEqual(expect.arrayContaining([expect.objectContaining({ index: true, file: "routes/studio.tsx" })]));
    expect(paths(routes)).toEqual(expect.arrayContaining(["api/studio/session", "api/studio/generate", "api/studio/images/:id", "admin/system-update", "admin/login"]));
  });
});
