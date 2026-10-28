import { createHash } from "node:crypto";
import { httpError } from "../../contracts/error";
import { tx } from "../tx.server";
import { studioClientAddress } from "./request.server";

export type StudioRateScope = "session" | "generate" | "upload" | "upload-chunk" | "upload-complete" | "read" | "events";
const rules: Record<StudioRateScope, { seconds: number; ip: number; owner: number; upload?: number }> = {
  session: { seconds: 3600, ip: 30, owner: 30 },
  generate: { seconds: 60, ip: 60, owner: 30 },
  upload: { seconds: 600, ip: 80, owner: 40 },
  // Four 4MiB images ×64 chunks ×3 attempts =768; allow bounded replay headroom.
  "upload-chunk": { seconds: 600, ip: 4096, owner: 2048, upload: 256 },
  "upload-complete": { seconds: 600, ip: 160, owner: 80, upload: 16 },
  read: { seconds: 60, ip: 600, owner: 240 },
  events: { seconds: 60, ip: 60, owner: 20 },
};

/** Atomic fixed windows shared by all web processes. Expired keys are reclaimed in bounded batches. */
export async function consumeStudioRate(request: Request, scope: StudioRateScope, userId?: string, options: { ownerOnly?: boolean; uploadId?: string } = {}): Promise<void> {
  const rule = rules[scope];
  const window = Math.floor(Date.now() / (rule.seconds * 1000));
  const buckets = options.ownerOnly ? [] : [{ identity: `ip:${studioClientAddress(request)}`, limit: rule.ip }];
  if (userId) buckets.push({ identity: `owner:${userId}`, limit: rule.owner });
  if (userId && options.uploadId && rule.upload) buckets.push({ identity: `upload:${userId}:${options.uploadId}`, limit: rule.upload });
  // Even an IP flood cannot create unlimited anonymous business users.
  if (scope === "session") buckets.push({ identity: "global", limit: 1000 });
  await tx(async (client) => {
    await client.query("DELETE FROM studio_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM studio_rate_limits WHERE expires_at<now() LIMIT 500)");
    for (const bucket of buckets) {
      const hash = createHash("sha256").update(`${scope}:${window}:${bucket.identity}`).digest("hex");
      const result = await client.query(
        `INSERT INTO studio_rate_limits(bucket_hash,hits,expires_at) VALUES($1,1,$2)
         ON CONFLICT(bucket_hash) DO UPDATE SET hits=studio_rate_limits.hits+1
         WHERE studio_rate_limits.hits<$3 RETURNING hits`,
        [hash, new Date((window + 1) * rule.seconds * 1000), bucket.limit],
      );
      if (result.rowCount !== 1) {
        const response = httpError(429, "RATE_LIMITED", "请求太频繁，请稍后再试");
        response.headers.set("Retry-After", String(Math.max(1, Math.ceil(((window + 1) * rule.seconds * 1000 - Date.now()) / 1000))));
        throw response;
      }
    }
  });
}
