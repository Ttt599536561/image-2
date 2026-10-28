import { redirect } from "react-router";
import { LandingPage } from "../../src/components/landing/LandingPage";
import { auth } from "../../src/lib/auth";
import { loadInspirations, loadLandingGallery } from "../../src/server/reads.server";
import type { Route } from "./+types/welcome";

export const meta: Route.MetaFunction = () => [
  { title: "one-image2 · 一句话生成你想要的画面" },
  {
    name: "description",
    content: "文生图、图生图、对话式二次编辑——像聊天一样创作图片，作品可下载保存。",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  // 闭环（方案 B，F-072）：已登录用户回到应用首页，不让老用户卡在营销页；
  // 与 _app 父 loader 的「未登录访问 / → /welcome」互为两端，无重定向循环。
  const s = await auth.api.getSession({ headers: request.headers });
  if (s) throw redirect("/");
  // F-073：管理员手动配置的首页画廊优先；未配置（null）时回退灵感库 active 卡
  // （loadInspirations 内部再回退种子）——落地页永不空。
  const landing = await loadLandingGallery();
  if (landing) return { items: landing };
  const { items } = await loadInspirations();
  return { items: items.slice(0, 14) };
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  return <LandingPage items={loaderData.items} />;
}
