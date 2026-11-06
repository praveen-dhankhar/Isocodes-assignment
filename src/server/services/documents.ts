import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { DocType } from "@/domain/fields";
import { AppError } from "@/lib/errors";
import { db } from "../db/client";
import { documentPages, documents, shipments } from "../db/schema";
import { renderPages } from "../pdf/render";
import { extractTextLayer } from "../pdf/text-layer";
import { shipmentStatus, toDocumentDTO, type DocumentDTO, type ShipmentStatusDTO } from "../queries/shipments";
import { blobStore } from "../storage";
import { EXTENSION, validateUpload } from "../uploads/validate";
import { audit } from "./audit";
import { recomputeShipment } from "./recompute";

/** Display only — never used in a storage key or path (ARCHITECTURE §9). */
const cleanFilename = (name: string) =>
  [...(name.split(/[\\/]/).pop() ?? "")].filter((c) => c >= " " && c !== "\u007f").join("").trim().slice(0, 200) || "document";

/**
 * ARCHITECTURE §7.1. Validates, renders pages and reads the text layer before touching the database, stores the
 * blobs under server-generated keys, then in one transaction: refuses an exported shipment, supersedes the slot's
 * current document (A-23), inserts the document and its pages, recomputes and audits.
 */
export async function uploadDocument(input: {
  shipmentId: string;
  docType: DocType;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  actorId: string;
}): Promise<{ document: DocumentDTO; shipment: ShipmentStatusDTO }> {
  const [existing] = await db().select({ status: shipments.status }).from(shipments).where(eq(shipments.id, input.shipmentId));
  if (!existing) throw new AppError("NOT_FOUND", "Shipment not found");
  if (existing.status === "EXPORTED") throw new AppError("INVALID_STATE", "Exported shipments are read-only until a manager reopens them");

  const upload = await validateUpload(input.bytes, { filename: input.filename, mimeType: input.mimeType });
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const pages = await renderPages(input.bytes, upload.kind);
  const text = upload.kind === "pdf" ? await extractTextLayer(input.bytes) : null;

  const documentId = randomUUID();
  const prefix = `shipments/${input.shipmentId}/${documentId}`;
  const storageKey = `${prefix}/original.${EXTENSION[upload.kind]}`;
  const store = blobStore();
  // ponytail: blobs are written before the transaction; a failed transaction leaves orphans. Sweep by prefix if that matters.
  await store.put(storageKey, input.bytes, upload.mimeType);
  for (const p of pages) await store.put(`${prefix}/page-${p.pageNo}.webp`, p.webp, "image/webp");

  return db().transaction(async (tx) => {
    const [shipment] = await tx.select({ status: shipments.status }).from(shipments).where(eq(shipments.id, input.shipmentId)).for("update");
    if (shipment?.status === "EXPORTED") throw new AppError("INVALID_STATE", "Exported shipments are read-only until a manager reopens them");

    const superseded = await tx
      .update(documents)
      .set({ supersededAt: sql`now()` })
      .where(and(eq(documents.shipmentId, input.shipmentId), eq(documents.docType, input.docType), isNull(documents.supersededAt)))
      .returning({ id: documents.id });
    for (const s of superseded) {
      await audit(tx, { actorId: input.actorId, action: "DOCUMENT_SUPERSEDED", entityType: "document", entityId: s.id, shipmentId: input.shipmentId, metadata: { docType: input.docType } });
    }

    const [doc] = await tx
      .insert(documents)
      .values({
        id: documentId, shipmentId: input.shipmentId, docType: input.docType, status: "UPLOADED", storageKey,
        originalFilename: cleanFilename(input.filename), mimeType: upload.mimeType, sizeBytes: input.bytes.length, sha256,
        pageCount: upload.pageCount, hasTextLayer: text?.hasTextLayer ?? false, uploadedBy: input.actorId,
      })
      .returning();
    if (!doc) throw new Error("document insert returned nothing");
    await tx.insert(documentPages).values(
      pages.map((p) => ({
        documentId, pageNo: p.pageNo, imageKey: `${prefix}/page-${p.pageNo}.webp`, width: p.width, height: p.height,
        textItems: text?.pages[p.pageNo - 1] ?? null,
      })),
    );

    await recomputeShipment(tx, input.shipmentId, input.actorId);
    await audit(tx, {
      actorId: input.actorId, action: "DOCUMENT_UPLOADED", entityType: "document", entityId: documentId, shipmentId: input.shipmentId,
      metadata: { docType: input.docType, pageCount: upload.pageCount, sizeBytes: input.bytes.length, kind: upload.kind },
    });
    return { document: toDocumentDTO(doc), shipment: await shipmentStatus(tx, input.shipmentId) };
  });
}

async function documentRow(documentId: string) {
  const [doc] = await db().select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new AppError("NOT_FOUND", "Document not found");
  return doc;
}

/** API_SPECS §4.4: the WebP for one page. */
export async function pageImage(documentId: string, pageNo: number) {
  const [page] = await db()
    .select({ imageKey: documentPages.imageKey })
    .from(documentPages)
    .where(and(eq(documentPages.documentId, documentId), eq(documentPages.pageNo, pageNo)));
  if (!page) throw new AppError("NOT_FOUND", "Page not found");
  return blobStore().stream(page.imageKey);
}

/** API_SPECS §4.5: the uploaded file as it arrived. */
export async function originalFile(documentId: string) {
  const doc = await documentRow(documentId);
  const file = await blobStore().stream(doc.storageKey);
  return { ...file, contentType: doc.mimeType, filename: doc.originalFilename };
}
