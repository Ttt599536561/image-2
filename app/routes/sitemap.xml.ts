import { PUBLIC_SEO_PATHS } from "../../src/lib/seo";
import { getSeoConfig } from "../../src/server/seo.server";

function xmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export function loader() {
  const { origin } = getSeoConfig();
  const urls = PUBLIC_SEO_PATHS.map((path) => `  <url><loc>${xmlEscape(new URL(path, origin).href)}</loc></url>`).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
