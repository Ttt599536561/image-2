import { studioSessionLoader } from "../../src/server/studio/api.server";

export function loader({ request }: { request: Request }): Promise<Response> {
  return studioSessionLoader(request);
}
