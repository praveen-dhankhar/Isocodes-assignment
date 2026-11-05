import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ShipmentSnapshot } from "@/domain/snapshot";
import { AppError } from "@/lib/errors";
import type { Tx } from "../db/client";
import { crossCheckResults, documents, extractedFields, lineItems, shipments } from "../db/schema";

type FieldRow = Pick<typeof extractedFields.$inferSelect, "id" | "documentId" | "lineItemId" | "fieldKey" | "value" | "status" | "confidence">;

// numeric(4,3) arrives as a string; confidence is a probability, not money, so a JS number is fine (API_SPECS §1).
const fieldRef = (f: FieldRow) => ({
  fieldId: f.id,
  value: f.value,
  status: f.status,
  confidence: f.confidence === null ? null : Number(f.confidence),
});

const byKey = (rows: FieldRow[]) => Object.fromEntries(rows.map((f) => [f.fieldKey, fieldRef(f)]));

/**
 * The engine's input (ARCHITECTURE §6.1) from DB rows: current documents, their fields and lines, and stored
 * resolutions. Locks the shipment row (FOR UPDATE) until the transaction ends. Zod-validated, so an unknown
 * field_key or out-of-range confidence fails here instead of inside the engine.
 */
export async function loadSnapshot(tx: Tx, shipmentId: string): Promise<ShipmentSnapshot> {
  const [shipment] = await tx
    .select({ id: shipments.id, ref: shipments.ref, status: shipments.status })
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .for("update");
  if (!shipment) throw new AppError("NOT_FOUND", "Shipment not found");

  const docs = await tx.select().from(documents).where(and(eq(documents.shipmentId, shipmentId), isNull(documents.supersededAt)));
  const docIds = docs.map((d) => d.id);
  const lines = docIds.length === 0 ? [] : await tx.select().from(lineItems).where(inArray(lineItems.documentId, docIds));
  const fields: FieldRow[] =
    docIds.length === 0
      ? []
      : await tx
          .select({
            id: extractedFields.id, documentId: extractedFields.documentId, lineItemId: extractedFields.lineItemId,
            fieldKey: extractedFields.fieldKey, value: extractedFields.value, status: extractedFields.status,
            confidence: extractedFields.confidence,
          })
          .from(extractedFields)
          .where(inArray(extractedFields.documentId, docIds));
  const resolved = await tx
    .select({ ruleId: crossCheckResults.ruleId, scope: crossCheckResults.scope, type: crossCheckResults.resolution, fingerprint: crossCheckResults.fingerprint, declaredValue: crossCheckResults.declaredValue })
    .from(crossCheckResults)
    .where(and(eq(crossCheckResults.shipmentId, shipmentId), isNotNull(crossCheckResults.resolution)));

  const priorResolutions: Record<string, Record<string, unknown>> = {};
  for (const { ruleId, scope, ...prior } of resolved) (priorResolutions[ruleId] ??= {})[scope] = prior;

  return ShipmentSnapshot.parse({
    shipmentId: shipment.id,
    ref: shipment.ref,
    status: shipment.status,
    documents: Object.fromEntries(
      docs.map((d) => [
        d.docType,
        {
          documentId: d.id,
          status: d.status,
          detectedDocType: d.detectedDocType,
          wrongTypeDismissed: d.wrongTypeDismissed,
          header: byKey(fields.filter((f) => f.documentId === d.id && f.lineItemId === null)),
          lines: lines
            .filter((l) => l.documentId === d.id)
            .sort((a, b) => a.lineNo - b.lineNo)
            .map((l) => ({ lineNo: l.lineNo, cells: byKey(fields.filter((f) => f.lineItemId === l.id)) })),
        },
      ]),
    ),
    priorResolutions,
  });
}
