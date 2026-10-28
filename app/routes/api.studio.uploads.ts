import { studioUploadsAction } from "../../src/server/studio/api.server";

export function action({ request }: { request: Request }): Promise<Response> {
  return studioUploadsAction(request);
}
