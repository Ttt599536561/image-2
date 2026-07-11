import { httpError } from "../../src/contracts/error";
import {
  isLocalTestStorageEnabled,
  readLocalStorageObject,
} from "../../src/server/local-storage.server";
import type { Route } from "./+types/api.local-storage";

export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (!isLocalTestStorageEnabled()) return httpError(404, "NOT_FOUND", "资源不存在");
  const storageKey = new URL(request.url).searchParams.get("key");
  if (!storageKey) return httpError(404, "NOT_FOUND", "资源不存在");
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
      },
    });
  } catch {
    return httpError(404, "NOT_FOUND", "资源不存在");
  }
}
