// 公告链接安全分类（§9 广播公告，前后端单一真相源）。只放行「站内单层路径」或「http(s) 外链」。
// 🔴 安全：其余一律 null=拒绝——含 `javascript:`/`data:` 伪协议、协议相对 `//evil`，以及反斜杠 `/\evil`
//    （浏览器按 WHATWG 把 `\` 规整为 `/`，`/\evil`→`//evil` 会变协议相对外跳 → 开放重定向）。
// 调用方传入「已 trim」的字符串（前端发送前 trim、契约校验同值）；本函数不再 trim，留空白即判 null。
export type AnnouncementLinkKind = "internal" | "external";

export function classifyAnnouncementLink(s: string): AnnouncementLinkKind | null {
  if (!s || s.includes("\\")) return null; // 反斜杠整体拒绝（= `//` 的等价规整形式）
  if (/^https?:\/\//i.test(s)) return "external"; // http(s) 外链
  if (s.startsWith("/") && !s.startsWith("//")) return "internal"; // 站内单层路径
  return null;
}
