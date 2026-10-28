// POST /api/redeem（07 §8.4 / 03 §4.7）。敏感写：requireUserStrict → 限流 → 核销事务（调既有 redeemCode，绝不重写钱逻辑）。
// 错误码：400 BAD_CODE_FORMAT / 404 CODE_NOT_FOUND / 410 CODE_USED|CODE_DISABLED / 429 RATE_LIMITED。失败才计限流。
import { httpError } from "../../src/contracts/error";
import { RedeemRequest, RedeemResponse } from "../../src/contracts/redeem";
import { requireUserStrict } from "../../src/lib/guard";
import {
  checkRedeemRateLimit,
  RedeemError,
  recordRedeemFailure,
  redeemCode,
} from "../../src/server/money/redeem.server";
import { clientIp } from "../../src/server/rateLimit";
import type { Route } from "./+types/api.redeem";

export async function action({ request }: Route.ActionArgs) {
  try {
    if (request.method !== "POST") return httpError(405, "INVALID_PARAM", "method_not_allowed");
    const ctx = await requireUserStrict(request); // 401/403（封禁）
    const ip = clientIp(request);

    // 限流（仅计失败；命中抛 RedeemError 429）。
    await checkRedeemRateLimit({ userId: ctx.userId, ip });

    let body: RedeemRequest;
    try {
      body = RedeemRequest.parse(await request.json());
    } catch {
      // 格式不符（防枚举：与 404 同文案「兑换码无效」）。格式错不计入失败限流（非真核销尝试）。
      return httpError(400, "BAD_CODE_FORMAT", "兑换码无效");
    }

    try {
      const res = await redeemCode({ userId: ctx.userId, code: body.code });
      return Response.json(RedeemResponse.parse(res)); // 200 {balanceMp, creditsValueMp}
    } catch (e) {
      if (e instanceof RedeemError) {
        await recordRedeemFailure({ userId: ctx.userId, ip, code: e.code }); // 喂限流窗口
        return httpError(e.httpStatus, e.code, e.message);
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof Response) return e; // guard 401/403
    if (e instanceof RedeemError) return httpError(e.httpStatus, e.code, e.message); // 限流 429
    console.error("[api.redeem] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
