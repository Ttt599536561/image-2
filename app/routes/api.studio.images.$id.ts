import { studioImageLoader } from "../../src/server/studio/api.server";

export function loader({ request, params }: { request: Request, params: { id?: string } }): Promise<Response> {
  return studioImageLoader(request, params.id);
}
