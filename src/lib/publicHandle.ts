// 公开掩码昵称（§13.1 投稿署名）。隐私默认：不暴露完整邮箱，只露 local 前缀 + ***。
// 纯函数、无密钥；审核通过时在服务端把结果冻结进 inspirations.submitter_name。
export function publicHandleFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  if (!local) return "匿名用户";
  if (local.length <= 1) return `${local}***`;
  return `${local.slice(0, 2)}***`;
}
