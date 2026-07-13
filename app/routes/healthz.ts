import { getSql } from "../../src/db/db.server";

export async function loader(): Promise<Response> {
  try {
    await getSql()`
      SELECT g.deadline_at, g.credential_mode, g.source_image_id
      FROM generations g
      LEFT JOIN generation_credentials c ON c.generation_id = g.id
      LIMIT 0`;
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
