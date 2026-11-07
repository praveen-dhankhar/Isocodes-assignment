import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { downloadExport } from "@/server/services/export";
import { requireUser } from "@/server/session";

// API_SPECS §4.7: re-download a stored export exactly as it was written; audited.
export const runtime = "nodejs";

const Params = z.object({ id: z.uuid(), exportId: z.uuid() });
const Query = z.object({ format: z.enum(["csv", "xlsx"]).default("csv") });

export async function GET(request: Request, ctx: RouteContext<"/api/shipments/[id]/exports/[exportId]">) {
  try {
    const user = await requireUser();
    const { id, exportId } = Params.parse(await ctx.params);
    const { format } = Query.parse({ format: new URL(request.url).searchParams.get("format") ?? undefined });
    const file = await downloadExport({ shipmentId: id, exportId, format, actorId: user.id });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
