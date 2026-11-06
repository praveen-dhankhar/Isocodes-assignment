import "server-only";
import { and, eq, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { ConfidenceSignals } from "@/domain/confidence";
import { HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { AppError } from "@/lib/errors";
import { db, type Tx } from "../db/client";
import { documentPages, documents, extractedFields, lineItems } from "../db/schema";
import { audit } from "./audit";
import { lockShipment, recomputeShipment } from "./recompute";

const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;
const slotKeys = (registry: Record<string, FieldDef>, slot: DocType) => Object.keys(registry).filter((k) => registry[k]?.on[slot]);

/** The current (not superseded) document and its shipment, locked, version-checked and not exported. */
async function lockDocument(tx: Tx, documentId: string, expectedVersion: number) {
  const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), isNull(documents.supersededAt)));
  if (!doc) throw new AppError("NOT_FOUND", "Document not found");
  await lockShipment(tx, doc.shipmentId, expectedVersion);
  return doc;
}

const emptyRow = (doc: typeof documents.$inferSelect, fieldKey: string, lineItemId: string | null) => ({
  shipmentId: doc.shipmentId, documentId: doc.id, lineItemId, fieldKey, rawText: null, value: null, originalAiValue: null,
  modelConfidence: null, confidence: null, confidenceSignals: null, pageNo: null, bbox: null, status: "UNREVIEWED" as const,
});

/**
 * API_SPECS §5.2 markPageUnreadable (PRD F7): the page is unreadable; fields read from it are cleared to confidence 0
 * with a PAGE_UNREADABLE cap and block until someone enters them. original_ai_value is kept (rule 6), and a later
 * entry counts as MANUAL_ENTRY, not as an AI correction. With no AI values left the document's mode becomes MANUAL.
 */
export async function markPageUnreadable(input: { documentId: string; pageNo: number; expectedVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const doc = await lockDocument(tx, input.documentId, input.expectedVersion);
    const [page] = await tx
      .update(documentPages)
      .set({ readable: false })
      .where(and(eq(documentPages.documentId, doc.id), eq(documentPages.pageNo, input.pageNo)))
      .returning({ id: documentPages.id });
    if (!page) throw new AppError("NOT_FOUND", "Page not found");

    const fromPage = await tx.select().from(extractedFields).where(and(eq(extractedFields.documentId, doc.id), eq(extractedFields.pageNo, input.pageNo)));
    for (const f of fromPage) {
      const previous = (f.confidenceSignals ?? null) as ConfidenceSignals | null;
      const signals: ConfidenceSignals = {
        model: previous?.model ?? Number(f.modelConfidence ?? 0),
        caps: [...(previous?.caps ?? []).filter((c) => c.reason !== "PAGE_UNREADABLE"), { reason: "PAGE_UNREADABLE", cap: 0 }],
        evidence: previous?.evidence ?? "NO_TEXT_LAYER",
      };
      await tx
        .update(extractedFields)
        .set({ value: null, confidence: "0.000", confidenceSignals: signals, status: "UNREVIEWED", version: sql`${extractedFields.version} + 1` })
        .where(eq(extractedFields.id, f.id));
    }

    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(extractedFields)
      .where(and(eq(extractedFields.documentId, doc.id), isNotNull(extractedFields.value), isNotNull(extractedFields.originalAiValue)));
    if ((left?.n ?? 0) === 0) await tx.update(documents).set({ mode: "MANUAL" }).where(eq(documents.id, doc.id));

    await audit(tx, { actorId: input.actorId, action: "PAGE_MARKED_UNREADABLE", entityType: "document", entityId: doc.id, shipmentId: doc.shipmentId, metadata: { pageNo: input.pageNo, fieldsCleared: fromPage.length } });
    const { version } = await recomputeShipment(tx, doc.shipmentId, input.actorId);
    return { shipmentVersion: version };
  });
}

/**
 * "Enter manually" for a document the model could not read (FAILED, or uploaded but never extracted): one empty row per
 * registry field of the slot, so required ones block until entered. The document becomes MANUAL.
 */
export async function startManualEntry(input: { documentId: string; expectedVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const doc = await lockDocument(tx, input.documentId, input.expectedVersion);
    if (doc.status !== "FAILED" && doc.status !== "UPLOADED") throw new AppError("INVALID_STATE", "Only a document that has not been read can be entered by hand");
    const existing = new Set(
      (await tx.select({ key: extractedFields.fieldKey }).from(extractedFields).where(and(eq(extractedFields.documentId, doc.id), isNull(extractedFields.lineItemId)))).map((r) => r.key),
    );
    const rows = slotKeys(HEADER, doc.docType).filter((k) => !existing.has(k)).map((k) => emptyRow(doc, k, null));
    if (rows.length > 0) await tx.insert(extractedFields).values(rows);
    await tx.update(documents).set({ status: "MANUAL", mode: "MANUAL", errorCode: null, errorMessage: null }).where(eq(documents.id, doc.id));
    const { version } = await recomputeShipment(tx, doc.shipmentId, input.actorId);
    return { shipmentVersion: version };
  });
}

/** API_SPECS §5.2 addLineItem: a new last line with an empty cell per line field of the slot (tables typed by hand). */
export async function addLineItem(input: { documentId: string; expectedVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const doc = await lockDocument(tx, input.documentId, input.expectedVersion);
    if (doc.docType === "BILL_OF_LADING") throw new AppError("INVALID_STATE", "A bill of lading has no line items");
    const [last] = await tx.select({ n: max(lineItems.lineNo) }).from(lineItems).where(eq(lineItems.documentId, doc.id));
    const lineNo = (last?.n ?? 0) + 1;
    const [item] = await tx.insert(lineItems).values({ documentId: doc.id, lineNo }).returning({ id: lineItems.id });
    if (!item) throw new Error("line insert returned nothing");
    const fields = await tx
      .insert(extractedFields)
      .values(slotKeys(LINE, doc.docType).map((k) => emptyRow(doc, k, item.id)))
      .returning({ id: extractedFields.id });
    const { version } = await recomputeShipment(tx, doc.shipmentId, input.actorId);
    return { lineNo, fieldIds: fields.map((f) => f.id), shipmentVersion: version };
  });
}

/** API_SPECS §5.2 removeLineItem: only lines with no AI values (added by hand). */
export async function removeLineItem(input: { documentId: string; lineNo: number; expectedVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const doc = await lockDocument(tx, input.documentId, input.expectedVersion);
    const [item] = await tx.select().from(lineItems).where(and(eq(lineItems.documentId, doc.id), eq(lineItems.lineNo, input.lineNo)));
    if (!item) throw new AppError("NOT_FOUND", "Line not found");
    const [fromAi] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(extractedFields)
      .where(and(eq(extractedFields.lineItemId, item.id), isNotNull(extractedFields.originalAiValue)));
    if ((fromAi?.n ?? 0) > 0) throw new AppError("INVALID_STATE", "This line was read from the document; correct its values instead of removing it");
    await tx.delete(lineItems).where(eq(lineItems.id, item.id)); // its fields cascade
    const { version } = await recomputeShipment(tx, doc.shipmentId, input.actorId);
    return { shipmentVersion: version };
  });
}

/** API_SPECS §5.2 dismissWrongType: "Keep as <slot>" when the model thought the file was another document type. */
export async function dismissWrongType(input: { documentId: string; expectedVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const doc = await lockDocument(tx, input.documentId, input.expectedVersion);
    await tx.update(documents).set({ wrongTypeDismissed: true }).where(eq(documents.id, doc.id));
    await audit(tx, { actorId: input.actorId, action: "WRONG_TYPE_DISMISSED", entityType: "document", entityId: doc.id, shipmentId: doc.shipmentId, metadata: { docType: doc.docType, detected: doc.detectedDocType } });
    const { version } = await recomputeShipment(tx, doc.shipmentId, input.actorId);
    return { shipmentVersion: version };
  });
}
