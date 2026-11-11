import { getSeoConfig } from "../../src/server/seo.server";

export function loader() {
  const { origin } = getSeoConfig();
  return new Response([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /media/",
    "Disallow: /healthz",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
