// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loader } from "./legacy-redirect";

describe("retired public URLs", () => {
  it("permanently redirects retired pages to the canonical workspace", () => {
    for (const path of ["/welcome", "/login", "/register", "/billing", "/c/old-session"]) {
      const response = loader({ request: new Request(`https://example.com${path}`) });
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/");
    }
  });
  it("keeps unknown URLs as genuine 404 responses", () => {
    expect(loader({ request: new Request("https://example.com/unknown") }).status).toBe(404);
  });
});
