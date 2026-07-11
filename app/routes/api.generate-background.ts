import handler from "../../netlify/functions/generate-background";
import { httpError } from "../../src/contracts/error";
import type { Route } from "./+types/api.generate-background";

export function loader(): Response {
  return httpError(404, "NOT_FOUND", "资源不存在");
}

export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (process.env.DISPOSABLE_TEST_DB_DRIVER !== "pg") {
    return httpError(404, "NOT_FOUND", "资源不存在");
  }

  const body = (await request.json().catch(() => ({}))) as { generationId?: string };
  if (!body.generationId) {
    return httpError(400, "INVALID_PARAM", "参数无效");
  }

  const backgroundRequest = new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationId: body.generationId }),
  });
  void handler(backgroundRequest)
    .then((response) => {
      if (!response.ok) console.error("[local-background] generation failed");
    })
    .catch(() => console.error("[local-background] generation failed"));

  return Response.json({ accepted: true }, { status: 202 });
}
