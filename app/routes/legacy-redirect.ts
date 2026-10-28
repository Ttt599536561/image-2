import { redirect } from "react-router";
import { httpError } from "../../src/contracts/error";

const oldPages = new Set(["/welcome", "/login", "/register", "/forgot", "/billing", "/account", "/assets", "/inspiration"]);
export function loader({ request }: { request: Request }) {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (oldPages.has(path) || /^\/c\/[^/]+$/.test(path)) return redirect("/");
  return httpError(404, "NOT_FOUND", "页面或接口不存在");
}
export function action() { return httpError(404, "NOT_FOUND", "页面或接口不存在"); }
