import type { ConversationDetail } from "../../src/contracts/conversation";
import { ConversationView } from "../../src/components/conversation/ConversationView";
import { requireUserPage } from "../../src/server/page.server";
import { loadConversationDetail } from "../../src/server/reads.server";
import { getQueryClient } from "../queryClient";
import type { Route } from "./+types/_app.c.$id";

// 某会话线程 /c/:id —— 续聊该会话。loader 取会话详情（owner-scoped，非本人 → 404）。
export async function loader({ request, params }: Route.LoaderArgs) {
  const { userId } = await requireUserPage(request);
  const detail = await loadConversationDetail(userId, params.id);
  return { detail };
}

// ⚡ 客户端导航优先用缓存即时渲染：乐观新建（提交时已写缓存）或之前加载过 → 命中即返回、
// 不阻塞跨境服务端 loader 往返（点击即跳、当即看到生图骨架）；无缓存（直接开链接/刷新）才回源。
// 数据新鲜度交给 useConversationDetail（staleTime 30s 自动后台刷新）+ 轮询终态对账。
// 不设 clientLoader.hydrate → 首屏 SSR/刷新仍走服务端 loader，hydration 不重跑。
export async function clientLoader({ params, serverLoader }: Route.ClientLoaderArgs) {
  const cached = getQueryClient().getQueryData<ConversationDetail>(["conversation", params.id]);
  if (cached) return { detail: cached };
  return await serverLoader();
}

export default function ConversationRoute({ params, loaderData }: Route.ComponentProps) {
  return <ConversationView conversationId={params.id} initialDetail={loaderData.detail} />;
}
