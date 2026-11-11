// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loader as studioLoader, meta } from "./studio";
import { meta as rootMeta } from "../root";
import { loader as robotsLoader } from "./robots.txt";
import { loader as sitemapLoader } from "./sitemap.xml";
import { getSeoConfig } from "../../src/server/seo.server";
import { PUBLIC_SITE_ORIGIN } from "../../src/lib/seo";

afterEach(() => vi.unstubAllEnvs());

function metaArgs(error?: Error): Parameters<typeof meta>[0] {
  const seo = { origin: "https://studio.example" };
  return {
    loaderData: { seo },
    params: {},
    location: { pathname: "/", search: "?tracking=ignored", hash: "", state: null, key: "test" },
    matches: [
      { id: "root", pathname: "/", params: {}, meta: [], loaderData: { theme: "light", seo } },
      { id: "routes/studio", pathname: "/", params: {}, meta: [], loaderData: { seo } },
    ],
    error,
  };
}

describe("public studio search metadata", () => {
  it("describes the fixed-service product and declares one canonical URL", () => {
    const tags = meta(metaArgs());
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://studio.example/" });
    expect(tags).toContainEqual({ name: "robots", content: "index, follow, max-image-preview:large" });
    const descriptionTag = tags.find((tag) => "name" in tag && tag.name === "description");
    const description = descriptionTag && "content" in descriptionTag ? descriptionTag.content : undefined;
    expect(description).toContain("文生图");
    expect(description).toContain("图生图");
    expect(description).toContain("API Key");
    expect(description).not.toContain("自己的图片服务 URL");
    expect(tags.filter((tag) => "title" in tag)).toHaveLength(1);
    expect(tags).toContainEqual({ property: "og:url", content: "https://studio.example/" });
    expect(tags).toContainEqual({ name: "twitter:image", content: "https://studio.example/og-image.png" });
  });

  it("keeps root pages and studio errors out of the index without canonical or application data", () => {
    for (const tags of [rootMeta(), meta(metaArgs(new Error("Unavailable")))]) {
      expect(tags).toContainEqual({ name: "robots", content: "noindex, nofollow" });
      expect(tags.some((tag) => "script:ld+json" in tag || "rel" in tag)).toBe(false);
    }
  });

  it("publishes factual website/application data without invented reviews or offers", () => {
    const tags = meta(metaArgs());
    const schemaTag = tags.find((tag) => "script:ld+json" in tag);
    const schema = schemaTag && "script:ld+json" in schemaTag ? schemaTag["script:ld+json"] : undefined;
    expect(schema).toMatchObject({ "@graph": expect.arrayContaining([
      expect.objectContaining({ "@type": "WebSite", url: "https://studio.example/" }),
      expect.objectContaining({ "@type": "WebApplication", url: "https://studio.example/" }),
    ]) });
    expect(JSON.stringify(schema)).not.toMatch(/aggregateRating|offers|review|price/);
  });
});

describe("deployment-owned SEO origin and verification", () => {
  it("uses only deployment config for the public loader and strips URL extras", () => {
    vi.stubEnv("STUDIO_PUBLIC_ORIGIN", "https://studio.example/subpath?x=1#test");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example");
    expect(getSeoConfig().origin).toBe("https://studio.example");
    const data = studioLoader();
    expect(data.seo.origin).toBe("https://studio.example");
  });

  it("falls back safely when origins are missing or invalid", () => {
    vi.stubEnv("STUDIO_PUBLIC_ORIGIN", "javascript:alert(1)");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example/path");
    expect(getSeoConfig().origin).toBe("https://auth.example");
    vi.stubEnv("BETTER_AUTH_URL", "https://user:password@example.com");
    expect(getSeoConfig().origin).toBe(PUBLIC_SITE_ORIGIN);
    vi.stubEnv("STUDIO_PUBLIC_ORIGIN", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(getSeoConfig().origin).toBe(PUBLIC_SITE_ORIGIN);
  });

  it("exposes only a valid Google verification token", () => {
    vi.stubEnv("GOOGLE_SITE_VERIFICATION", " token_with-dash_123 ");
    expect(getSeoConfig().googleSiteVerification).toBe("token_with-dash_123");
    vi.stubEnv("GOOGLE_SITE_VERIFICATION", '<meta content="bad">');
    expect(getSeoConfig().googleSiteVerification).toBeUndefined();
  });
});

describe("crawler discovery resources", () => {
  it("allows public pages/assets and admin noindex discovery, excludes private endpoints, and advertises its sitemap", async () => {
    vi.stubEnv("STUDIO_PUBLIC_ORIGIN", "https://studio.example");
    const response = robotsLoader();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("User-agent: *\nAllow: /");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /media/");
    expect(body).not.toMatch(/Disallow: \/(?:admin|assets)/);
    expect(body).toContain("Sitemap: https://studio.example/sitemap.xml");
  });

  it("lists only canonical public pages and never private routes or fabricated last-modified dates", async () => {
    vi.stubEnv("STUDIO_PUBLIC_ORIGIN", "https://studio.example");
    const response = sitemapLoader();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/xml");
    const body = await response.text();
    const urls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(urls).toEqual(["https://studio.example/", "https://studio.example/guide"]);
    expect(body).not.toContain("<lastmod>");
  });
});
