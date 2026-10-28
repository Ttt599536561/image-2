// Administrator bootstrap maintains ownership, without balances or signup rewards.
import { getSql } from "../db/db.server";

export async function onUserRegistered(user: { id: string; email: string }): Promise<void> {
  await getSql()`INSERT INTO users(id, email) VALUES(${user.id}, ${user.email})
    ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email, updated_at=now()`;
}

export async function onSessionCreated(session: { userId: string }): Promise<void> {
  const rows = await getSql()`SELECT id, email FROM "user" WHERE id=${session.userId} LIMIT 1`;
  if (rows[0]) await onUserRegistered({ id: String(rows[0].id), email: String(rows[0].email) });
}
