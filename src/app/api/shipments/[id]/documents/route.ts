import { z } from "zod";
import { DocType } from "@/domain/fields";
import { errorResponse } from "@/lib/errors";
import { uploadDocument } from "@/server/services/documents";
import { requireUser } from "@/server/session";

// API_SPECS §4.1: upload one document into a slot. Size, type and page limits are enforced by the upload service (A-02).
export const runtime = "nodejs";
export const maxDuration = 60;

const Params = z.object({ id: z.uuid() });
const UploadForm = z.object({
  docType: DocType,
  file: z.instanceof(File).refine((f) => f.size > 0, "Empty file"),
});

export async function POST(request: Request, ctx: RouteContext<"/api/shipments/[id]/documents">) {
  try {
    const user = await requireUser();
    const { id } = Params.parse(await ctx.params);
    const form = await request.formData();
    const { docType, file } = UploadForm.parse({ docType: form.get("docType"), file: form.get("file") });
    const result = await uploadDocument({
      shipmentId: id, docType, bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mimeType: file.type, actorId: user.id,
    });
    return Response.json(result, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
