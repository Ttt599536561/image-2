import { z } from "zod";
import type { ErrorCode, GenerateStatusResponse } from "../../contracts/generate";
import { getSql } from "../../db/db.server";
import { expireDueGenerations } from "./deadline.server";

export type StatusQueryResult =
  | { ok: true; single: boolean; ids: string[] }
  | { ok: false };

export function parseGenerationStatusQuery(rawUrl: string): StatusQueryResult {
  const params = new URL(rawUrl).searchParams;
  const id = params.get("id");
  const rawIds = params.get("ids");
  if ((id && rawIds) || (!id && !rawIds)) return { ok: false };
  const ids = [...new Set(id ? [id] : (rawIds as string).split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > 50 || ids.some((value) => !z.uuid().safeParse(value).success)) {
    return { ok: false };
  }
  return { ok: true, single: Boolean(id), ids };
}

export async function loadGenerationStatuses(
  userId: string,
  ids: string[],
): Promise<GenerateStatusResponse[]> {
  const uniqueIds = [...new Set(ids)].slice(0, 50);
  if (uniqueIds.length === 0) return [];
  await expireDueGenerations({ generationIds: uniqueIds, userId });
  const rows = await getSql()`SELECT g.id,g.credential_mode,g.deadline_at,g.status,g.started_at,
                                    g.error_code,g.error,g.http_status,g.duration_ms,g.credits_charged_mp,
                                    i.public_url,i.width,i.height
                             FROM generations g LEFT JOIN images i ON i.generation_id=g.id
                             WHERE g.id=ANY(${uniqueIds}::uuid[]) AND g.user_id=${userId}`;
  return rows.map((row) => {
    const identity = {
      generationId: row.id as string,
      credentialMode: row.credential_mode as "system" | "custom",
      deadlineAt: new Date(row.deadline_at as string | Date).toISOString(),
    };
    if (row.status === "succeeded") {
      return {
        ...identity,
        status: "succeeded" as const,
        image: {
          publicUrl: row.public_url as string,
          width: row.width == null ? null : Number(row.width),
          height: row.height == null ? null : Number(row.height),
        },
        creditsChargedMp: Number(row.credits_charged_mp),
        durationMs: Number(row.duration_ms ?? 0),
      };
    }
    if (row.status === "failed") {
      return {
        ...identity,
        status: "failed" as const,
        errorCode: row.error_code as ErrorCode,
        error: String(row.error ?? "生成失败，请重试"),
        httpStatus: row.http_status == null ? null : Number(row.http_status),
        creditsChargedMp: 0 as const,
      };
    }
    const startedAt = row.started_at
      ? new Date(row.started_at as string | Date).toISOString()
      : undefined;
    return {
      ...identity,
      status: row.status as "queued" | "claimed" | "running",
      startedAt,
      elapsedMs: row.started_at
        ? Math.max(0, Date.now() - new Date(row.started_at as string | Date).getTime())
        : undefined,
    };
  });
}
