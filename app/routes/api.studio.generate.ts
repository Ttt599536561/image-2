import { studioGenerateAction } from "../../src/server/studio/api.server";

export function action({ request }: { request: Request }): Promise<Response> {
  return studioGenerateAction(request);
}
