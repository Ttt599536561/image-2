import { LandingPage } from "../../src/components/landing/LandingPage";
import { loadInspirations } from "../../src/server/reads.server";
import type { Route } from "./+types/welcome";

export const meta: Route.MetaFunction = () => [
  { title: "AI 图像工坊 · 一句话生成你想要的画面" },
  {
    name: "description",
    content: "文生图、图生图、对话式二次编辑——像聊天一样创作图片，作品可下载保存。",
  },
];

export async function loader() {
  // 公开只读：仅取 active 灵感卡；表空/异常时 loadInspirations 内部回退种子。
  const { items } = await loadInspirations();
  return { items: items.slice(0, 14) };
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  return <LandingPage items={loaderData.items} />;
}
