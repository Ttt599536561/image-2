// Better Auth catch-all handler（05 §6.1）。RR 资源路由（无 UI、只回 JSON）：/api/auth/*。
// loader 处理 GET（get-session 等），action 处理 POST（sign-up/in/out 等）。
// ⑤ 收口限流（07 §8.6）：sign-in 10/10min（IP+邮箱）、sign-up 5/小时（IP），只计失败（>=400 才记）。
import { httpError } from "../../src/contracts/error";
import { auth } from "../../src/lib/auth";
import { clientIp, isRateLimited, type RateKind, recordRateFailure } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.auth.$";

export const loader = ({ request }: Route.LoaderArgs) => auth.handler(request);

function rateKindFor(path: string): RateKind | null {
  if (path.includes("/sign-in")) return "sign_in";
  if (path.includes("/sign-up")) return "sign_up";
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const kind = rateKindFor(new URL(request.url).pathname);
  if (!kind) return auth.handler(request);

  const ip = clientIp(request);
  // sign-in 维度含邮箱（clone 读 body，不消费原始 request）；sign-up 仅按 IP。
  let subject: string | null = null;
  if (kind === "sign_in") {
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      subject = typeof body.email === "string" ? body.email.toLowerCase() : null;
    } catch {
      // 非 JSON body → 仅按 IP
    }
  }

  if (await isRateLimited(kind, { ip, subject })) {
    return httpError(429, "RATE_LIMITED", "尝试过多，请稍后再试");
  }

  const res = await auth.handler(request);
  if (res.status >= 400) {
    await recordRateFailure(kind, { ip, subject }).catch(() => {});
  }
  return res;
}
