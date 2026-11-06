import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { getShipmentStatus } from "@/server/queries/shipments";
import { requireUser } from "@/server/session";

// API_SPECS §4.3: polled every 2 s while a document is EXTRACTING.
export const runtime = "nodejs";

const Params = z.object({ id: z.uuid() });

export async function GET(_request: Request, ctx: RouteContext<"/api/shipments/[id]/status">) {
  try {
    await requireUser();
    const { id } = Params.parse(await ctx.params);
    return Response.json(await getShipmentStatus(id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
