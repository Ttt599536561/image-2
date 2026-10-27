import { Client, type Notification } from "pg";
import { z } from "zod";
import { usesPgDriver } from "../../db/db-driver.server";

export type GenerationChange = { generationId: string; userId: string };
type Subscription = { listener: (change: GenerationChange) => void; onReady?: () => void };
const subscriptions = new Set<Subscription>();
let current: Client | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 250;

function safely(callback: () => void): void {
  try { callback(); } catch { /* One consumer must not interrupt other consumers. */ }
}

function end(client: Client): void {
  void client.end().catch(() => {});
}

function connect(): void {
  if (current || retry || subscriptions.size === 0) return;
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) { scheduleRetry(); return; }
  const client = new Client({
    connectionString, connectionTimeoutMillis: 5_000, query_timeout: 5_000,
    keepAlive: true, keepAliveInitialDelayMillis: 10_000,
  });
  current = client;
  const lost = () => {
    if (current !== client) return;
    current = undefined;
    end(client);
    scheduleRetry();
  };
  client.on("error", lost);
  client.on("end", lost);
  client.on("notification", (message: Notification) => {
    if (current !== client || message.channel !== "generation_changes" || !message.payload) return;
    try {
      const payload: unknown = JSON.parse(message.payload);
      const parsed = z.object({ generationId: z.uuid(), userId: z.uuid() }).safeParse(payload);
      if (!parsed.success) return;
      for (const subscriber of subscriptions) safely(() => subscriber.listener(parsed.data));
    } catch { /* Invalid notifications never enter application state or logs. */ }
  });
  void (async () => {
    try {
      await client.connect();
      if (current !== client) return;
      await client.query("LISTEN generation_changes");
      if (current !== client) return;
      retryDelay = 250;
      // LISTEN can miss committed changes before connection/reconnection. Re-read the DB.
      for (const subscriber of subscriptions) if (subscriber.onReady) safely(subscriber.onReady);
    } catch { lost(); }
  })();
}

function scheduleRetry(): void {
  if (retry || subscriptions.size === 0) return;
  retry = setTimeout(() => { retry = undefined; connect(); }, retryDelay);
  retry.unref?.();
  retryDelay = Math.min(retryDelay * 2, 10_000);
}

/** NOTIFY is only a wake-up hint. Callers must re-read owned authoritative rows. */
export function subscribeGenerationChanges(
  listener: (change: GenerationChange) => void,
  onReady?: () => void,
): () => void {
  if (!usesPgDriver()) return () => {};
  const subscriber = { listener, onReady };
  subscriptions.add(subscriber);
  connect();
  return () => {
    subscriptions.delete(subscriber);
    if (subscriptions.size > 0) return;
    if (retry) clearTimeout(retry);
    retry = undefined;
    retryDelay = 250;
    const client = current;
    current = undefined;
    if (client) end(client);
  };
}
