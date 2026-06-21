import type {
  GenerateAccepted,
  GenerateRequest,
  GenerateStatusResponse,
} from "../contracts/generate";
import { makePlaceholderImage } from "./images";

// 阶段一 mock 生成「API」：严格镜像真契约（202 入队 → 短轮询 → 判别联合三态）。
// 阶段二只把这两个函数换成真 fetch（/api/generate、/api/generate-status），UI/hook 不变。

export const PRICE_PER_IMAGE_MP = 70; // 0.07 积分/张（app_config.price_per_image_mp 默认）
export const SIGNUP_GRANT_MP = 140; // 注册赠送 0.14（2 张）

type Job = {
  prompt: string;
  size: GenerateRequest["size"];
  startedAt: number;
  durationMs: number;
  outcome: "success" | "failure";
};

const jobs = new Map<string, Job>();

// 确定性失败触发：提示词含 fail / 失败 / error 即走失败分支（便于演示/测试失败态）。
function shouldFail(prompt: string): boolean {
  return /fail|失败|error|报错/i.test(prompt);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `gen_${Math.floor(performance.now())}_${jobs.size}`;
}

/** POST /api/generate → 202 入队（mock 延迟 ~120ms）。 */
export async function mockGenerate(req: GenerateRequest): Promise<GenerateAccepted> {
  await delay(120);
  const id = uuid();
  jobs.set(id, {
    prompt: req.prompt,
    size: req.size,
    startedAt: Date.now(),
    durationMs: 3200 + Math.floor(Math.random() * 1800), // 3.2–5s 体感
    outcome: shouldFail(req.prompt) ? "failure" : "success",
  });
  return { generationId: id, status: "queued" };
}

/** GET /api/generate-status?id= → 判别联合三态（进行中 / succeeded / failed）。 */
export async function mockGetStatus(id: string): Promise<GenerateStatusResponse> {
  await delay(60);
  const job = jobs.get(id);
  if (!job) {
    return { status: "failed", errorCode: "unknown", error: "任务不存在", httpStatus: null };
  }
  const elapsed = Date.now() - job.startedAt;
  if (elapsed < job.durationMs) {
    return {
      status: "running",
      startedAt: new Date(job.startedAt).toISOString(),
      elapsedMs: elapsed,
    };
  }
  if (job.outcome === "failure") {
    // 成功才扣 → 失败未扣（前端按 creditsChargedMp===0 / 失败态判定「未扣/已退」）
    return {
      status: "failed",
      errorCode: "provider_timeout",
      error: "504 中转网关超时，请重试",
      httpStatus: 504,
    };
  }
  return {
    status: "succeeded",
    image: makePlaceholderImage(job.prompt, job.size),
    creditsChargedMp: PRICE_PER_IMAGE_MP,
    durationMs: job.durationMs,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
