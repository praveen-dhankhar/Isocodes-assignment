import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { extractDocument } from "@/server/services/extraction";
import { requireUser } from "@/server/session";

// API_SPECS §4.2: run extraction for one document. 200 also when extraction failed — the outcome is on the document.
export const runtime = "nodejs";
export const maxDuration = 300;

const Params = z.object({ id: z.uuid(), docId: z.uuid() });
const ExtractBody = z.object({
  force: z.boolean().default(false), // re-extract an EXTRACTED/MANUAL document
  discardHumanEdits: z.boolean().default(false), // required when human-edited fields exist
});

export async function POST(request: Request, ctx: RouteContext<"/api/shipments/[id]/documents/[docId]/extract">) {
  try {
    const user = await requireUser();
    const { id, docId } = Params.parse(await ctx.params);
    const text = await request.text();
    const body = ExtractBody.parse(text.trim() === "" ? {} : JSON.parse(text));
    return Response.json(await extractDocument({ shipmentId: id, documentId: docId, ...body, actorId: user.id }));
  } catch (e) {
    return errorResponse(e instanceof SyntaxError ? new z.ZodError([{ code: "custom", path: [], message: "Body is not valid JSON", input: undefined }]) : e);
  }
}
