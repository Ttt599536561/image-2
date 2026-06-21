import { BillingPage } from "../../src/components/billing/BillingPage";
import { loadPackages } from "../../src/server/reads.server";
import type { Route } from "./+types/_app.billing";

// 充值页 —— loader 取套餐（active+sort，公开数据；鉴权由 _app 父 loader 守卫）。余额走 useMe。
export async function loader() {
  return { packages: await loadPackages() };
}

export default function Billing({ loaderData }: Route.ComponentProps) {
  return <BillingPage initialPackages={loaderData.packages} />;
}
