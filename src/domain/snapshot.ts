import { z } from "zod";
import { PriorResolution, RuleId } from "./checks/types";
import { DocType, HeaderFieldKey, LineFieldKey } from "./fields";

// ARCHITECTURE §6.1: the engine's whole input, built by server/services/snapshot.ts from DB rows.
// Zod-validated there, so a stray field_key or out-of-range confidence never reaches the engine.

export const ShipmentStatus = z.enum([
  "DRAFT", "EXTRACTING", "NEEDS_REVIEW", "EXTRACTED", "READY_FOR_APPROVAL", "APPROVED", "EXPORTED", "ON_HOLD",
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

export const DocStatus = z.enum(["UPLOADED", "EXTRACTING", "EXTRACTED", "FAILED", "MANUAL"]);
export type DocStatus = z.infer<typeof DocStatus>;

export const FieldStatus = z.enum(["UNREVIEWED", "CONFIRMED", "CORRECTED", "MANUAL"]);
export type FieldStatus = z.infer<typeof FieldStatus>;

export const FieldRef = z.object({
  fieldId: z.string(),
  value: z.string().nullable(), // canonical (PRD §7); null = absent
  status: FieldStatus,
  confidence: z.number().min(0).max(1).nullable(), // final, after caps (PRD §8)
});
export type FieldRef = z.infer<typeof FieldRef>;

export const SnapshotLine = z.object({
  lineNo: z.number().int().positive(),
  cells: z.partialRecord(LineFieldKey, FieldRef),
});
export type SnapshotLine = z.infer<typeof SnapshotLine>;

export const SnapshotDocument = z.object({
  documentId: z.string(),
  status: DocStatus,
  detectedDocType: z.string().nullable(),
  wrongTypeDismissed: z.boolean(),
  header: z.partialRecord(HeaderFieldKey, FieldRef),
  lines: z.array(SnapshotLine),
});
export type SnapshotDocument = z.infer<typeof SnapshotDocument>;

export const ShipmentSnapshot = z.object({
  shipmentId: z.string(),
  ref: z.string(),
  status: ShipmentStatus,
  documents: z.partialRecord(DocType, SnapshotDocument), // current documents only; a missing slot is absent
  priorResolutions: z.partialRecord(RuleId, z.record(z.string(), PriorResolution)), // by rule, then scope
});
export type ShipmentSnapshot = z.infer<typeof ShipmentSnapshot>;

/** A document the checks read: extraction finished or entered by hand. A missing or unfinished slot has its own
 * blocking issue (PRD §10.1), so checks skip it instead of blocking twice. */
export function readyDocument(snapshot: ShipmentSnapshot, docType: DocType): SnapshotDocument | undefined {
  const doc = snapshot.documents[docType];
  return doc && (doc.status === "EXTRACTED" || doc.status === "MANUAL") ? doc : undefined;
}
