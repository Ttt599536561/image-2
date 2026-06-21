// Better Auth catch-all handler（05 §6.1）。RR 资源路由（无 UI、只回 JSON）：/api/auth/*。
// loader 处理 GET（get-session 等），action 处理 POST（sign-up/in/out 等）。
import { auth } from "../../src/lib/auth";
import type { Route } from "./+types/api.auth.$";

export const loader = ({ request }: Route.LoaderArgs) => auth.handler(request);
export const action = ({ request }: Route.ActionArgs) => auth.handler(request);
