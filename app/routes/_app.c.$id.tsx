import { ConversationView } from "../../src/components/conversation/ConversationView";
import { requireUserPage } from "../../src/server/page.server";
import { loadConversationDetail } from "../../src/server/reads.server";
import type { Route } from "./+types/_app.c.$id";

// 某会话线程 /c/:id —— 续聊该会话。loader 取会话详情（owner-scoped，非本人 → 404）。
export async function loader({ request, params }: Route.LoaderArgs) {
  const { userId } = await requireUserPage(request);
  const detail = await loadConversationDetail(userId, params.id);
  return { detail };
}

export default function ConversationRoute({ params, loaderData }: Route.ComponentProps) {
  return <ConversationView conversationId={params.id} initialDetail={loaderData.detail} />;
}
