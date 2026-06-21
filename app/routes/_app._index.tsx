import { ConversationView } from "../../src/components/conversation/ConversationView";

// 主对话页 /（新建生成）—— 无 conversationId，首次提交懒建会话。
export default function Home() {
  return <ConversationView conversationId={null} />;
}
