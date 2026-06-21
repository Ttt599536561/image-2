import { InspirationPage } from "../../src/components/inspiration/InspirationPage";
import { loadInspirations } from "../../src/server/reads.server";
import type { Route } from "./+types/_app.inspiration";

// 灵感库 —— loader 取灵感卡（公开种子；鉴权由 _app 父 loader 守卫）。品类/搜索本地过滤。
export async function loader() {
  return { inspirations: await loadInspirations() };
}

export default function Inspiration({ loaderData }: Route.ComponentProps) {
  return <InspirationPage initialInspirations={loaderData.inspirations} />;
}
