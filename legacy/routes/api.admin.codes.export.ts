// GET /api/admin/codes/export?batchId=（09 §10.2）。导出批次 CSV（BOM 防 Excel 乱码）。
import { httpError } from "../../src/contracts/error";
import { requireAdmin } from "../../src/lib/guard";
import { exportBatchCsv } from "../../src/server/admin/codes.server";
import type { Route } from "./+types/api.admin.codes.export";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await requireAdmin(request);
    const batchId = new URL(request.url).searchParams.get("batchId");
    if (!batchId) return httpError(400, "INVALID_PARAM", "missing batchId");
    const { csv, filename } = await exportBatchCsv(batchId);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("[api.admin.codes.export] error", e);
    return httpError(500, "INTERNAL", "服务异常，请重试");
  }
}
