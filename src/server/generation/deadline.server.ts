import { getSql } from "../../db/db.server";

export interface ExpireDueArgs {
  generationIds?: string[];
  userId?: string;
  now?: Date;
}

export async function expireDueGenerations(
  args: ExpireDueArgs = {},
): Promise<Array<{ id: string; userId: string }>> {
  const ids = args.generationIds?.length ? args.generationIds : null;
  const injectedNow = args.now?.toISOString() ?? null;
  const userId = args.userId ?? null;
  const rows = await getSql()`
    WITH clock AS (
      SELECT COALESCE(${injectedNow}::timestamptz, now()) AS at
    ),
    expired AS (
      UPDATE generations
      SET status='failed',error_code='provider_timeout',
          error='请求超时，本站未扣积分，请重试',http_status=NULL,credits_charged_mp=0,
          completed_at=clock.at,
          duration_ms=CASE WHEN started_at IS NULL THEN NULL
                           ELSE LEAST(
                             GREATEST(EXTRACT(EPOCH FROM (clock.at-started_at))*1000,0),
                             2147483647
                           )::int END,
          updated_at=clock.at
      FROM clock
      WHERE status IN ('queued','claimed','running') AND deadline_at<=clock.at
        AND (${ids}::uuid[] IS NULL OR id=ANY(${ids}::uuid[]))
        AND (${userId}::uuid IS NULL OR user_id=${userId}::uuid)
      RETURNING generations.id,generations.user_id,generations.credential_mode
    ),
    deleted_credentials AS (
      DELETE FROM generation_credentials AS credentials
      USING expired
      WHERE credentials.generation_id=expired.id
      RETURNING credentials.generation_id
    ),
    inserted_events AS (
      INSERT INTO events(type,user_id,payload)
      SELECT 'image_failed',user_id,
             jsonb_build_object('generationId',id,'reason','provider_timeout','credentialMode',credential_mode)
      FROM expired
      RETURNING id
    )
    SELECT id,user_id FROM expired`;
  return rows.map((row) => ({ id: row.id as string, userId: row.user_id as string }));
}
