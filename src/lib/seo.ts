import type { MetaDescriptor } from "react-router";

export const PUBLIC_SITE_ORIGIN = "https://one-image2.tangguo.xin";
export const SEO_SITE_NAME = "AI 图像工坊";
export const PUBLIC_SEO_PATHS = ["/", "/guide"] as const;

export function createPageMeta({ origin, path, title, description }: {
  origin: string;
  path: (typeof PUBLIC_SEO_PATHS)[number];
  title: string;
  description: string;
}): MetaDescriptor[] {
  const url = new URL(path, origin).href;
  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: "index, follow, max-image-preview:large" },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SEO_SITE_NAME },
    { property: "og:locale", content: "zh_CN" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: `${origin}/og-image.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "AI 图像工坊 — GPT Image 文生图与图生图工作台" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `${origin}/og-image.png` },
    { name: "twitter:image:alt", content: "AI 图像工坊 — GPT Image 文生图与图生图工作台" },
  ];
}

export function createNoIndexMeta(title = SEO_SITE_NAME): MetaDescriptor[] {
  return [{ title }, { name: "robots", content: "noindex, nofollow" }];
}
