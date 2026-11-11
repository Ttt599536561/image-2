import { StudioPage } from "../../src/components/studio/StudioPage";
import { createNoIndexMeta, createPageMeta, PUBLIC_SITE_ORIGIN, SEO_SITE_NAME } from "../../src/lib/seo";
import { getSeoConfig } from "../../src/server/seo.server";
import type { Route } from "./+types/studio";

export function loader() { return { seo: { origin: getSeoConfig().origin } }; }

export function meta({ loaderData, error }: Route.MetaArgs) {
  if (error) return createNoIndexMeta();
  const origin = loaderData?.seo.origin ?? PUBLIC_SITE_ORIGIN;
  const description = "AI 图像工坊提供 GPT Image 文生图与图生图工作台，支持最多 4 张参考图、尺寸与画质设置、原图下载和本机历史。无需注册，填写固定图片服务的 API Key 即可创作。";
  return [
    ...createPageMeta({ origin, path: "/", title: "AI 图像工坊 - GPT Image 文生图与图生图工作台", description }),
    { "script:ld+json": {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": `${origin}/#website`, name: SEO_SITE_NAME, url: `${origin}/`, inLanguage: "zh-CN" },
        { "@type": "WebApplication", "@id": `${origin}/#application`, name: SEO_SITE_NAME, url: `${origin}/`, description,
          applicationCategory: "MultimediaApplication", operatingSystem: "Web", inLanguage: "zh-CN",
          featureList: ["文生图", "图生图与最多 4 张参考图", "图片尺寸与画质设置", "原图下载", "浏览器本机历史"],
        },
      ],
    } },
  ];
}
export default function StudioRoute() { return <StudioPage />; }
