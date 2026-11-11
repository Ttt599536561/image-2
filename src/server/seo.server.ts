import { PUBLIC_SITE_ORIGIN } from "../lib/seo";

/** Only deployment configuration may set canonical URLs, never the request Host. */
export function getSeoConfig(): { origin: string; googleSiteVerification?: string } {
  let origin = PUBLIC_SITE_ORIGIN;
  for (const candidate of [process.env.STUDIO_PUBLIC_ORIGIN, process.env.BETTER_AUTH_URL]) {
    if (!candidate?.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
      origin = url.origin;
      break;
    } catch { /* Fall back to the next configured origin, then the production site. */ }
  }
  const token = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return {
    origin,
    ...(token && /^[A-Za-z0-9_-]{1,256}$/.test(token) ? { googleSiteVerification: token } : {}),
  };
}
