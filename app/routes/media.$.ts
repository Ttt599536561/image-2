import { httpError } from "../../src/contracts/error";
import { requireStudioSession } from "../../src/server/studio/session.server";
import { consumeStudioRate } from "../../src/server/studio/limits.server";
import {
  isLocalStorageEnabled,
  readLocalStorageObject,
  storageKeyFromLocalPublicUrl,
} from "../../src/server/local-storage.server";
import type { Route } from "./+types/media.$";

function notFound(): Response {
  return httpError(404, "NOT_FOUND", "Resource not found");
}

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (!isLocalStorageEnabled()) return notFound();
  const storageKey = storageKeyFromLocalPublicUrl(request.url);
  if (!storageKey) return notFound();

  try {
    const publicAsset = /^(inspirations|landing)\//.test(storageKey);
    if (!publicAsset) {
      await consumeStudioRate(request, "read");
      const { userId } = await requireStudioSession(request);
      await consumeStudioRate(request, "read", userId, { ownerOnly: true });
      const owner = storageKey.startsWith("uploads/") ? storageKey.split("/")[1] : storageKey.split("/")[0];
      if (owner !== userId) return notFound();
    }
    const object = await readLocalStorageObject(storageKey);
    const body = object.bytes.buffer.slice(
      object.bytes.byteOffset,
      object.bytes.byteOffset + object.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": publicAsset ? "public, max-age=31536000, immutable" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
