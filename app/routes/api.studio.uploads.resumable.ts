import { studioUploadCreateAction } from "../../src/server/studio/resumable-api.server";
export function action({ request }: { request: Request }): Promise<Response> { return studioUploadCreateAction(request); }
