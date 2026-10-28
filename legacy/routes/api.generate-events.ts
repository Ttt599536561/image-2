import { httpError } from "../../src/contracts/error";
import { usesPgDriver } from "../../src/db/db-driver.server";
import { requireUserStrict } from "../../src/lib/guard";
import { subscribeGenerationChanges } from "../../src/server/generation/notifications.server";
import { loadGenerationStatuses, parseGenerationStatusQuery } from "../../src/server/generation/status.server";
import type { Route } from "./+types/api.generate-events";

/** One shared database listener serves all streams; each snapshot is owner scoped. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const { userId } = await requireUserStrict(request);
    const query = parseGenerationStatusQuery(request.url);
    if (!query.ok) return httpError(400, "INVALID_PARAM", "任务 ID 无效");
    if (!usesPgDriver()) return httpError(503, "INTERNAL", "请使用状态查询");
    const ids = new Set(query.ids);
    const encoder = new TextEncoder();
    let finish = (_close = true) => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let loading = false;
        let dirty = false;
        let unsubscribe = () => {};
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lifetime: ReturnType<typeof setTimeout> | undefined;
        finish = (close = true) => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (lifetime) clearTimeout(lifetime);
          request.signal.removeEventListener("abort", onAbort);
          if (close) controller.close();
        };
        const send = (value: string) => {
          if (!closed) controller.enqueue(encoder.encode(value));
        };
        const refresh = async () => {
          if (closed) return;
          if (loading) { dirty = true; return; }
          loading = true;
          try {
            do {
              dirty = false;
              const items = await loadGenerationStatuses(userId, query.ids);
              if (closed) return;
              const found = new Set(items.map((item) => item.generationId));
              send(`event: status\ndata: ${JSON.stringify({ items, missingIds: query.ids.filter((id) => !found.has(id)) })}\n\n`);
            } while (dirty && !closed);
          } catch {
            // EventSource enters reconnect mode; the client keeps its batch polling fallback.
            finish();
          } finally { loading = false; }
        };
        const onAbort = () => finish();
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) { finish(); return; }
        send("retry: 5000\n\n");
        unsubscribe = subscribeGenerationChanges(
          (change) => { if (change.userId === userId && ids.has(change.generationId)) void refresh(); },
          () => { void refresh(); },
        );
        // Subscribe before reading so a commit racing the first snapshot cannot be missed.
        void refresh();
        heartbeat = setInterval(() => {
          send(": heartbeat\n\n");
          void refresh(); // Recovery scan also covers dropped NOTIFY messages.
        }, 15_000);
        // Native EventSource reconnects and revalidates the session at least once per minute.
        lifetime = setTimeout(finish, 60_000);
        heartbeat.unref?.(); lifetime.unref?.();
      },
      cancel() { finish(false); },
    });
    return new Response(body, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error) {
    if (error instanceof Response) return error;
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
