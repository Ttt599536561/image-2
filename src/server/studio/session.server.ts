import { createHash, randomBytes, randomUUID } from "node:crypto";
import { httpError } from "../../contracts/error";
import { getSql } from "../../db/db.server";
import { tx } from "../tx.server";
import { consumeStudioRate } from "./limits.server";

export const STUDIO_COOKIE_NAME = "studio_session";
const SESSION_SECONDS = 90 * 24 * 60 * 60;
export type StudioOwner = { userId: string; maxConcurrency: 10 };

function readToken(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === STUDIO_COOKIE_NAME) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
    }
  }
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function findOwner(request: Request): Promise<StudioOwner | undefined> {
  const token = readToken(request);
  if (!token) return undefined;
  const rows = await getSql()`SELECT s.user_id FROM studio_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=${tokenHash(token)} AND s.expires_at>now() AND u.is_banned=false`;
  if (rows[0]) return { userId: rows[0].user_id as string, maxConcurrency: 10 };
}

/** Sensitive routes must never replace a missing/expired cookie with a new owner. */
export async function requireStudioSession(request: Request): Promise<StudioOwner> {
  const owner = await findOwner(request);
  if (!owner) throw httpError(401, "UNAUTHENTICATED", "浏览器会话已失效，请刷新工作台");
  return owner;
}

export async function getOrCreateStudioSession(request: Request): Promise<StudioOwner & { cookie?: string }> {
  const owner = await findOwner(request);
  if (owner) return owner;
  await consumeStudioRate(request, "session");
  const token = randomBytes(32).toString("base64url");
  const userId = randomUUID();
  await tx(async (client) => {
    // Business owner only: no Better Auth user/account/session and no signup credit hooks.
    await client.query("INSERT INTO users(id,email,max_concurrency) VALUES($1,$2,10)", [userId, `${randomUUID()}@anonymous.invalid`]);
    await client.query("INSERT INTO studio_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [tokenHash(token), userId, new Date(Date.now() + SESSION_SECONDS * 1000)]);
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { userId, maxConcurrency: 10, cookie: `${STUDIO_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}` };
}
