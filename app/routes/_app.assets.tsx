import { AssetsPage } from "../../src/components/assets/AssetsPage";
import { requireUserPage } from "../../src/server/page.server";
import { loadImages } from "../../src/server/reads.server";
import type { Route } from "./+types/_app.assets";

// 资产库 —— loader 取首屏图片（range=all，owner-scoped）。批量删除走 REST action。
export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireUserPage(request);
  return { images: await loadImages(userId, { range: "all" }) };
}

export default function Assets({ loaderData }: Route.ComponentProps) {
  return <AssetsPage initialImages={loaderData.images} />;
}
