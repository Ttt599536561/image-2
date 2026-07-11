import { httpError } from "../../src/contracts/error";
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
    const object = await readLocalStorageObject(storageKey);
    const body = object.bytes.buffer.slice(
      object.bytes.byteOffset,
      object.bytes.byteOffset + object.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
