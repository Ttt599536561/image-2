import { ConversationView } from "../../src/components/conversation/ConversationView";
import type { Route } from "./+types/_app.c.$id";

// 某会话线程 /c/:id —— 续聊该会话。
export default function ConversationRoute({ params }: Route.ComponentProps) {
  return <ConversationView conversationId={params.id} />;
}
