import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { HEADER_FIELDS, LINE_FIELDS, type FieldDef } from "@/domain/fields";
import { normalizeTyped } from "@/domain/normalize/field";
import { detectDecimalSeparator } from "@/domain/normalize/number";
import { deriveReviewStatus, transition } from "@/domain/status";
import { computeBlockingIssues } from "@/domain/issues";
import { runCrossChecks } from "@/domain/checks/run-checks";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { AppError } from "@/lib/errors";
import { db, type Tx } from "../db/client";
import { documentPages, documents, extractedFields, fieldEdits, lineItems, shipments, suppliers } from "../db/schema";
import { toFieldDTO, type FieldDTO } from "../queries/review-model";
import { audit } from "./audit";
import { lockShipment, recomputeShipment } from "./recompute";
import { loadSnapshot } from "./snapshot";

// API_SPECS §5.2 field actions and submit. Every write: lock the shipment, check the version, write the value and its
// field_edits row together (rule 6), recompute before commit (invariant 4).

const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;
const KIND_NOUN: Record<string, string> = {
  WEIGHT: "a weight", MONEY: "an amount", DECIMAL: "a number", INTEGER: "a whole number", DATE: "a date", CURRENCY: "a currency code",
  INCOTERM: "an Incoterm", CONTAINER_LIST: "container numbers", HS_CODE: "an HS code", UNIT: "a unit",
};

/** The field, its document and shipment, locked and version-checked; refuses exported shipments. */
async function lockField(tx: Tx, fieldId: string, expectedFieldVersion: number) {
  const [row] = await tx
    .select({ f: extractedFields, doc: documents, lineNo: lineItems.lineNo })
    .from(extractedFields)
    .innerJoin(documents, eq(documents.id, extractedFields.documentId))
    .leftJoin(lineItems, eq(lineItems.id, extractedFields.lineItemId))
    .where(eq(extractedFields.id, fieldId));
  if (!row || row.doc.supersededAt) throw new AppError("NOT_FOUND", "Field not found");
  const shipment = await lockShipment(tx, row.f.shipmentId);
  const [current] = await tx.select().from(extractedFields).where(eq(extractedFields.id, fieldId)).for("update");
  if (!current || current.version !== expectedFieldVersion) {
    throw new AppError("VERSION_CONFLICT", "Someone else changed this value; reload to see the latest", {
      current: current ? toFieldDTO(current, row.doc.docType, row.lineNo, false) : null,
    });
  }
  const def = (current.lineItemId ? LINE : HEADER)[current.fieldKey];
  if (!def) throw new AppError("INVALID_STATE", "Unknown field");
  return { field: current, doc: row.doc, lineNo: row.lineNo, shipment, def };
}

async function finish(tx: Tx, f: typeof extractedFields.$inferSelect, docType: FieldDTO["docType"], lineNo: number | null, actorId: string) {
  const { version, issues } = await recomputeShipment(tx, f.shipmentId, actorId);
  const needsReview = issues.some((i) => i.type === "FIELD_NEEDS_REVIEW" && i.ref.fieldId === f.id);
  const field = toFieldDTO(f, docType, lineNo, needsReview);
  if (!field) throw new Error("field DTO");
  return { field, shipmentVersion: version };
}

async function writeEdit(
  tx: Tx,
  ctx: Awaited<ReturnType<typeof lockField>>,
  change: { status: "CONFIRMED" | "CORRECTED" | "MANUAL"; value: string | null; action: "CONFIRM" | "CORRECT" | "MANUAL_ENTRY"; actorId: string },
) {
  const { field, doc, lineNo, shipment } = ctx;
  const [updated] = await tx
    .update(extractedFields)
    .set({ status: change.status, value: change.value, version: sql`${extractedFields.version} + 1` })
    .where(eq(extractedFields.id, field.id))
    .returning();
  if (!updated) throw new Error("field update returned nothing");
  await tx.insert(fieldEdits).values({
    fieldId: field.id, shipmentId: field.shipmentId, supplierId: shipment.supplierId, docType: doc.docType, fieldKey: field.fieldKey,
    action: change.action, previousValue: field.value, newValue: change.value, originalAiValue: field.originalAiValue,
    aiConfidence: field.confidence, userId: change.actorId,
  });
  return finish(tx, updated, doc.docType, lineNo, change.actorId);
}

/** "Confirm": the AI value is right. */
export async function confirmField(input: { fieldId: string; expectedFieldVersion: number; actorId: string }) {
  return db().transaction(async (tx) => {
    const ctx = await lockField(tx, input.fieldId, input.expectedFieldVersion);
    if (ctx.field.value === null) throw new AppError("INVALID_STATE", "There is no value to confirm; enter it instead");
    return writeEdit(tx, ctx, { status: "CONFIRMED", value: ctx.field.value, action: "CONFIRM", actorId: input.actorId });
  });
}

/**
 * "Correct" (the AI misread) or "Enter" (nothing usable was read). The input is read with the field's kind and the
 * document's own number convention. Typing exactly what the AI read counts as a confirmation, so accuracy stays honest.
 */
export async function setFieldValue(input: { fieldId: string; expectedFieldVersion: number; input: string; actorId: string }) {
  return db().transaction(async (tx) => {
    const ctx = await lockField(tx, input.fieldId, input.expectedFieldVersion);
    const { field, doc, def } = ctx;
    const printed = (await tx.select({ t: extractedFields.rawText }).from(extractedFields).where(eq(extractedFields.documentId, doc.id))).flatMap((r) => (r.t ? [r.t] : []));
    const [supplier] = await tx.select({ country: suppliers.countryCode }).from(suppliers).where(eq(suppliers.id, ctx.shipment.supplierId));
    const read = normalizeTyped(def.kind, input.input, { separator: detectDecimalSeparator(printed), supplierCountry: supplier?.country ?? null });
    if (read.value === null || !read.formatValid) {
      throw new AppError("VALIDATION_FAILED", `Couldn't read '${input.input}' as ${KIND_NOUN[def.kind] ?? "a value"}`, { fieldId: field.id });
    }

    const [page] = field.pageNo === null ? [] : await tx.select({ readable: documentPages.readable }).from(documentPages).where(and(eq(documentPages.documentId, doc.id), eq(documentPages.pageNo, field.pageNo)));
    const aiUsable = field.originalAiValue !== null && page?.readable !== false;
    if (aiUsable && read.value === field.originalAiValue) return writeEdit(tx, ctx, { status: "CONFIRMED", value: read.value, action: "CONFIRM", actorId: input.actorId });
    return writeEdit(tx, ctx, aiUsable ? { status: "CORRECTED", value: read.value, action: "CORRECT", actorId: input.actorId } : { status: "MANUAL", value: read.value, action: "MANUAL_ENTRY", actorId: input.actorId });
  });
}

/** PRD §10.3 gate 1: no unresolved issues. EXTRACTED → READY_FOR_APPROVAL. */
export async function submitForApproval(input: { shipmentId: string; expectedVersion: number; actor: { id: string; role: "DOCUMENTATION_EXECUTIVE" | "DOCUMENTATION_MANAGER" } }) {
  return db().transaction(async (tx) => {
    const row = await lockShipment(tx, input.shipmentId, input.expectedVersion);
    const snapshot = await loadSnapshot(tx, input.shipmentId);
    const issues = computeBlockingIssues(snapshot, runCrossChecks(snapshot, CHECK_CONFIG));
    const next = transition(row.status, "submit", {
      actor: input.actor, derived: deriveReviewStatus(snapshot, issues.length), unresolved: issues.length, submittedBy: row.submittedBy, discrepanciesAcknowledged: false,
    });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);
    const [updated] = await tx
      .update(shipments)
      .set({ status: next.data, submittedBy: input.actor.id, submittedAt: sql`now()`, version: sql`${shipments.version} + 1`, updatedAt: sql`now()` })
      .where(eq(shipments.id, input.shipmentId))
      .returning({ status: shipments.status, version: shipments.version });
    await audit(tx, { actorId: input.actor.id, action: "SUBMITTED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { from: row.status } });
    await audit(tx, { actorId: input.actor.id, action: "STATUS_CHANGED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { from: row.status, to: next.data } });
    return { status: updated?.status ?? next.data, shipmentVersion: updated?.version ?? 0 };
  });
}
