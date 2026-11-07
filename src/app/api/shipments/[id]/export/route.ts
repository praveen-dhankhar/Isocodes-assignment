import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { exportShipment, XLSX_TYPE } from "@/server/services/export";
import { requireUser } from "@/server/session";

// API_SPECS §4.6: the export gate runs here, on the server, inside the export transaction.
export const runtime = "nodejs";

const Params = z.object({ id: z.uuid() });
const ExportBody = z.object({ expectedVersion: z.number().int().positive(), format: z.enum(["csv", "xlsx"]).default("csv") });

export async function POST(request: Request, ctx: RouteContext<"/api/shipments/[id]/export">) {
  try {
    const user = await requireUser();
    const { id } = Params.parse(await ctx.params);
    const { expectedVersion, format } = ExportBody.parse(await request.json());
    const result = await exportShipment({ shipmentId: id, expectedVersion, actor: { id: user.id, role: user.role } });
    const file = result[format]; // both formats are stored; the response carries the one asked for
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": format === "xlsx" ? XLSX_TYPE : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "X-Export-Id": result.exportId,
        "X-Shipment-Version": String(result.shipmentVersion),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
