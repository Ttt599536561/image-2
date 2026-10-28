// Better Auth catch-all handler（05 §6.1）。RR 资源路由（无 UI、只回 JSON）：/api/auth/*。
// loader 处理 GET（get-session 等），action 处理 POST（sign-up/in/out 等）。
// ⑤ 收口限流（07 §8.6）：sign-in 10/10min（IP+邮箱）、sign-up 5/小时（IP），只计失败（>=400 才记）。
import { handleAdminAuth } from "../../src/server/admin-auth.server";
import type { Route } from "./+types/api.auth.$";

export const loader = ({ request }: Route.LoaderArgs) => handleAdminAuth(request);

export async function action({ request }: Route.ActionArgs) {
  return handleAdminAuth(request);
}
