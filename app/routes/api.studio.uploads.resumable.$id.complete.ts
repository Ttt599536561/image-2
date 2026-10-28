import { studioUploadCompleteAction } from "../../src/server/studio/resumable-api.server";
export function action({ request, params }: { request: Request; params: { id?: string } }): Promise<Response> { return studioUploadCompleteAction(request, params.id); }
