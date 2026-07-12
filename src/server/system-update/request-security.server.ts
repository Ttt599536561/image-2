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
    const requestOrigin = new URL(origin);
    const configuredOrigin = new URL(configuredUrl);
    const isHttpOrigin = (url: URL) => url.protocol === "https:" || url.protocol === "http:";
    const explicitDefaultPort =
      requestOrigin.protocol === "https:"
        ? `${requestOrigin.origin}:443`
        : requestOrigin.protocol === "http:"
          ? `${requestOrigin.origin}:80`
          : "";
    const hasOriginOnlySyntax =
      (origin === requestOrigin.origin || origin === explicitDefaultPort) &&
      requestOrigin.username === "" &&
      requestOrigin.password === "" &&
      requestOrigin.pathname === "/" &&
      requestOrigin.search === "" &&
      requestOrigin.hash === "";
    if (
      !isHttpOrigin(requestOrigin) ||
      !isHttpOrigin(configuredOrigin) ||
      !hasOriginOnlySyntax ||
      requestOrigin.origin !== configuredOrigin.origin
    ) {
      return httpError(403, "FORBIDDEN", ORIGIN_ERROR);
    }
  } catch {
    return httpError(403, "FORBIDDEN", ORIGIN_ERROR);
  }

  return null;
}
