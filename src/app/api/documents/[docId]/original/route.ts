import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { originalFile } from "@/server/services/documents";
import { requireUser } from "@/server/session";

// API_SPECS §4.5: the uploaded file, always as a download (never rendered inline: documents are untrusted input).
export const runtime = "nodejs";

const Params = z.object({ docId: z.uuid() });

/** RFC 6266: an ASCII fallback plus the UTF-8 name. */
function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[docId]/original">) {
  try {
    await requireUser();
    const { docId } = Params.parse(await ctx.params);
    const file = await originalFile(docId);
    return new Response(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": disposition(file.filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        ...(file.size === null ? {} : { "Content-Length": String(file.size) }),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
