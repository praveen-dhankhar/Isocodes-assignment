import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { pageImage } from "@/server/services/documents";
import { requireUser } from "@/server/session";

// API_SPECS §4.4: a page image. Keys are per document and never overwritten, so the image can be cached for a day.
export const runtime = "nodejs";

const Params = z.object({ docId: z.uuid(), page: z.coerce.number().int().min(1).max(99) });

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[docId]/pages/[page]">) {
  try {
    await requireUser();
    const { docId, page } = Params.parse(await ctx.params);
    const image = await pageImage(docId, page);
    return new Response(image.body, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        ...(image.size === null ? {} : { "Content-Length": String(image.size) }),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
