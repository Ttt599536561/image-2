import { ConversationView } from "../../src/components/conversation/ConversationView";
import { loadInspirations } from "../../src/server/reads.server";
import type { Route } from "./+types/_app._index";

// 主对话页 /（新建生成）—— 无 conversationId，首次提交懒建会话。
// loader 取灵感画廊种子（欢迎态展示；鉴权由 _app 父 loader 守卫）。
export async function loader() {
  return { inspirations: await loadInspirations() };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return <ConversationView conversationId={null} initialInspirations={loaderData.inspirations.items} />;
}
