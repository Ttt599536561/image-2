import { studioUploadChunkAction } from "../../src/server/studio/resumable-api.server";
export function action({ request, params }: { request: Request; params: { id?: string; index?: string } }): Promise<Response> { return studioUploadChunkAction(request, params.id, params.index); }
