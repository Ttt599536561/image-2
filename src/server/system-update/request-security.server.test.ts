import { describe, expect, it } from "vitest";
import { requireSystemUpdatePost } from "./request-security.server";

const env = { BETTER_AUTH_URL: "https://images.example.com" };

function request(method = "POST", headers: Record<string, string> = {}): Request {
  return new Request("https://images.example.com/api/admin/system-update", {
    method,
    headers,
  });
}

async function body(response: Response): Promise<unknown> {
  return response.json();
}

describe("requireSystemUpdatePost", () => {
  it("accepts POST JSON with a matching origin", () => {
    expect(
      requireSystemUpdatePost(
        request("POST", {
          "Content-Type": "application/json",
          Origin: "https://images.example.com",
        }),
        env,
      ),
    ).toBeNull();
  });

  it("accepts a JSON media type with parameters", () => {
    expect(
      requireSystemUpdatePost(
        request("post", {
          "Content-Type": " application/json ; charset=utf-8 ",
          Origin: "https://images.example.com",
        }),
        env,
      ),
    ).toBeNull();
  });

  it("rejects non-POST methods with the JSON error envelope", async () => {
    const response = requireSystemUpdatePost(
      request("GET", {
        "Content-Type": "application/json",
        Origin: "https://images.example.com",
      }),
      env,
    );
    expect(response?.status).toBe(405);
    expect(await body(response!)).toEqual({
      error: { code: "INVALID_PARAM", message: "method_not_allowed" },
    });
  });

  it.each([undefined, "", "text/plain", "application/json-patch+json"])(
    "rejects missing or non-JSON content type: %s",
    async (contentType) => {
      const headers: Record<string, string> = { Origin: "https://images.example.com" };
      if (contentType !== undefined) headers["Content-Type"] = contentType;
      const response = requireSystemUpdatePost(request("POST", headers), env);
      expect(response?.status).toBe(415);
      expect(await body(response!)).toEqual({
        error: { code: "INVALID_PARAM", message: "content_type_required" },
      });
    },
  );

  it.each([undefined, "", "null", "not a url", "https://other.example.com"])(
    "rejects missing, malformed, or mismatched origins: %s",
    async (origin) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (origin !== undefined) headers.Origin = origin;
      const response = requireSystemUpdatePost(request("POST", headers), env);
      expect(response?.status).toBe(403);
      expect(await body(response!)).toEqual({
        error: { code: "FORBIDDEN", message: "origin_not_allowed" },
      });
    },
  );

  it("normalizes default ports while comparing origins", () => {
    expect(
      requireSystemUpdatePost(
        request("POST", {
          "Content-Type": "application/json",
          Origin: "https://images.example.com:443",
        }),
        env,
      ),
    ).toBeNull();
  });

  it.each([undefined, "", "not a url"])("fails closed for configured URL: %s", async (url) => {
    const response = requireSystemUpdatePost(
      request("POST", {
        "Content-Type": "application/json",
        Origin: "https://images.example.com",
      }),
      { BETTER_AUTH_URL: url },
    );
    expect(response?.status).toBe(403);
    expect(await body(response!)).toEqual({
      error: { code: "FORBIDDEN", message: "origin_not_allowed" },
    });
  });
});
