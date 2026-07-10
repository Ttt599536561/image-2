import type { DebitInput } from "../money/debit.server";
import { readConfigInt } from "../config.server";
import { retentionExpiry } from "../r2.server";
import { tx } from "../tx.server";

export async function finalizeCustomSuccess(input: DebitInput): Promise<"succeeded" | "lost"> {
  return tx(async (client) => {
    const generation = await client.query(
      "SELECT status,credential_mode FROM generations WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [input.generationId, input.userId],
    );
    if (
      generation.rowCount === 0 ||
      generation.rows[0].status !== "running" ||
      generation.rows[0].credential_mode !== "custom"
    ) {
      return "lost";
    }

    const freeDays = await readConfigInt(client, "retention_free_days", 7);
    const paidDays = await readConfigInt(client, "retention_paid_days", 60);
    const user = await client.query("SELECT has_paid FROM users WHERE id=$1", [input.userId]);
    const expiresAt = retentionExpiry(
      { has_paid: Boolean(user.rows[0]?.has_paid) },
      { freeDays, paidDays },
    );
    await client.query(
      `INSERT INTO images(generation_id,user_id,storage_key,public_url,content_type,width,height,size_bytes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(generation_id) DO NOTHING`,
      [
        input.generationId,
        input.userId,
        input.storageKey,
        input.publicUrl,
        input.contentType ?? null,
        input.width ?? null,
        input.height ?? null,
        input.sizeBytes ?? null,
        expiresAt,
      ],
    );
    const updated = await client.query(
      `UPDATE generations SET status='succeeded',credits_charged_mp=0,completed_at=now(),
         duration_ms=(EXTRACT(EPOCH FROM now()-started_at)*1000)::int,updated_at=now()
       WHERE id=$1 AND status='running' AND credential_mode='custom' RETURNING duration_ms`,
      [input.generationId],
    );
    if (updated.rowCount !== 1) return "lost";
    await client.query("INSERT INTO events(type,user_id,payload) VALUES('image_succeeded',$1,$2)", [
      input.userId,
      {
        generationId: input.generationId,
        credentialMode: "custom",
        creditsChargedMp: 0,
        durationMs: Number(updated.rows[0].duration_ms),
      },
    ]);
    await client.query("DELETE FROM generation_credentials WHERE generation_id=$1", [input.generationId]);
    return "succeeded";
  });
}
