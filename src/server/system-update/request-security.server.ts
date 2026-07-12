import { httpError } from "../../contracts/error";

const METHOD_ERROR = "method_not_allowed";
const CONTENT_TYPE_ERROR = "content_type_required";
const ORIGIN_ERROR = "origin_not_allowed";

export function requireSystemUpdatePost(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  if (request.method.toUpperCase() !== "POST") {
    return httpError(405, "INVALID_PARAM", METHOD_ERROR);
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return httpError(415, "INVALID_PARAM", CONTENT_TYPE_ERROR);
  }

  const origin = request.headers.get("origin")?.trim();
  const configuredUrl = env.BETTER_AUTH_URL?.trim();
  if (!origin || !configuredUrl) {
    return httpError(403, "FORBIDDEN", ORIGIN_ERROR);
  }

  try {
    if (new URL(origin).origin !== new URL(configuredUrl).origin) {
      return httpError(403, "FORBIDDEN", ORIGIN_ERROR);
    }
  } catch {
    return httpError(403, "FORBIDDEN", ORIGIN_ERROR);
  }

  return null;
}
