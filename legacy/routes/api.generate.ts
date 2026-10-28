import handler from "../../netlify/functions/generate";
import type { Route } from "./+types/api.generate";

export function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return handler(request);
}

export function action({ request }: Route.ActionArgs): Promise<Response> {
  return handler(request);
}
