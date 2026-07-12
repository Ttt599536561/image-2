import type { MiddlewareFunction } from "react-router";
import { httpError } from "../../contracts/error";
import { readSystemUpdateStatus } from "./state.server";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type MiddlewareArgs = Parameters<MiddlewareFunction<Response>>[0];
type MiddlewareNext = Parameters<MiddlewareFunction<Response>>[1];
type MaintenanceReader = () => boolean | Promise<boolean>;

async function readMaintenance(): Promise<boolean> {
  return (await readSystemUpdateStatus())?.maintenance === true;
}

export async function rejectHttpWriteDuringMaintenance(
  { request }: MiddlewareArgs,
  next: MiddlewareNext,
  isMaintenance: MaintenanceReader = readMaintenance,
): Promise<Response | void> {
  if (!WRITE_METHODS.has(request.method.toUpperCase())) return next();

  let maintenance: boolean;
  try {
    maintenance = await isMaintenance();
  } catch {
    return httpError(
      503,
      "MAINTENANCE",
      "系统维护状态暂时无法确认，写入操作已暂时停用，请稍后重试",
    );
  }

  if (maintenance) {
    return httpError(503, "MAINTENANCE", "系统正在维护升级，请稍后重试");
  }
  return next();
}
