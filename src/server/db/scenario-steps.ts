import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DocType, FieldKey } from "@/domain/fields";
import { approveShipment } from "../services/approval";
import { exportShipment } from "../services/export";
import { raiseImporterQuery } from "../services/resolutions";
import { confirmField, setFieldValue, submitForApproval } from "../services/review";
import { db } from "./client";
import { crossCheckResults, documents, extractedFields, fieldEdits, lineItems, shipments } from "./schema";

// PLAN M8.4: the human part of the seeded history, done through the same services the screens call. Each step names
// what a person did and why, so S7 (accuracy) and S8 (history) show real corrections, confirmations and a query.

export interface Person {
  id: string;
  role: "DOCUMENTATION_EXECUTIVE" | "DOCUMENTATION_MANAGER";
}

async function field(shipmentId: string, docType: DocType, key: FieldKey, lineNo?: number) {
  const [row] = await db()
    .select({ id: extractedFields.id, version: extractedFields.version })
    .from(extractedFields)
    .innerJoin(documents, eq(documents.id, extractedFields.documentId))
    .leftJoin(lineItems, eq(lineItems.id, extractedFields.lineItemId))
    .where(and(eq(extractedFields.shipmentId, shipmentId), eq(documents.docType, docType), isNull(documents.supersededAt), eq(extractedFields.fieldKey, key), lineNo === undefined ? isNull(extractedFields.lineItemId) : eq(lineItems.lineNo, lineNo)));
  if (!row) throw new Error(`seed scenario: no ${docType} ${key}${lineNo ? ` line ${lineNo}` : ""}`);
  return row;
}
const version = async (shipmentId: string) => (await db().select({ v: shipments.version }).from(shipments).where(eq(shipments.id, shipmentId)))[0]?.v ?? 0;

export function steps(shipmentId: string) {
  return {
    /** The model misread; type what the document says. */
    correct: async (who: Person, docType: DocType, key: FieldKey, printed: string, lineNo?: number) => {
      const f = await field(shipmentId, docType, key, lineNo);
      await setFieldValue({ fieldId: f.id, expectedFieldVersion: f.version, input: printed, actorId: who.id });
    },
    /** Nothing usable was read (unreadable page); type it from the document. Recorded as a manual entry. */
    enter: async (who: Person, docType: DocType, key: FieldKey, printed: string) => {
      const f = await field(shipmentId, docType, key);
      await setFieldValue({ fieldId: f.id, expectedFieldVersion: f.version, input: printed, actorId: who.id });
    },
    confirm: async (who: Person, docType: DocType, key: FieldKey, lineNo?: number) => {
      const f = await field(shipmentId, docType, key, lineNo);
      await confirmField({ fieldId: f.id, expectedFieldVersion: f.version, actorId: who.id });
    },
    submit: async (who: Person) => submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: who }),
    /** Approve, acknowledging every accepted discrepancy (none on the seeded shipments that get this far). */
    approve: async (who: Person) => approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: who }),
    export: async (who: Person) => exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: who }),
    query: async (who: Person, ruleIds: string[], message: string) => {
      const checks = await db().select({ id: crossCheckResults.id, ruleId: crossCheckResults.ruleId }).from(crossCheckResults).where(eq(crossCheckResults.shipmentId, shipmentId));
      const checkIds = checks.filter((c) => ruleIds.includes(c.ruleId)).map((c) => c.id);
      await raiseImporterQuery({ shipmentId, expectedVersion: await version(shipmentId), checkIds, message, actor: who });
    },
  };
}

/** A scenario runs once: a shipment that already has human edits is left alone. */
export async function touchedByPeople(shipmentId: string): Promise<boolean> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(fieldEdits).where(eq(fieldEdits.shipmentId, shipmentId));
  return (row?.n ?? 0) > 0;
}

/**
 * PLAN M8.4 and M9.4 targets: SHP-24812 stays EXTRACTED; SHP-24813 → APPROVED; SHP-24816 → EXPORTED;
 * SHP-24817 → READY_FOR_APPROVAL; SHP-24818 → ON_HOLD. Meera approves what Asha or Vikram submitted (A-14).
 */
export const HUMAN_SCENARIOS: Record<string, (s: ReturnType<typeof steps>, people: { asha: Person; vikram: Person; meera: Person }) => Promise<unknown>> = {
  "SHP-24813": async (s, { asha, meera }) => {
    await s.correct(asha, "PACKING_LIST", "netWeight", "560.00 KG"); // read 580
    await s.correct(asha, "INVOICE", "hsCode", "8413.60.10", 1); // a digit dropped
    await s.submit(asha);
    await s.approve(meera);
  },
  "SHP-24816": async (s, { asha, vikram, meera }) => {
    await s.correct(asha, "INVOICE", "invoiceNumber", "US-2026-4471"); // 1 read as 7
    await s.confirm(asha, "INVOICE", "invoiceDate"); // US supplier: 10/03 is 3 October
    await s.confirm(vikram, "BILL_OF_LADING", "grossWeight"); // "1,000 KGS" is one thousand
    await s.submit(vikram);
    await s.approve(meera);
    await s.export(meera);
  },
  "SHP-24817": async (s, { vikram }) => {
    await s.correct(vikram, "INVOICE", "unitPrice", "11.30", 1); // 3 read as 8
    await s.confirm(vikram, "INVOICE", "description", 1);
    await s.submit(vikram);
  },
  "SHP-24818": async (s, { asha }) => {
    // Packing list page 2 is a blurred scan; the weights were typed from the supplier's copy, packages were not legible.
    await s.enter(asha, "PACKING_LIST", "grossWeight", "720.00 KGS");
    await s.enter(asha, "PACKING_LIST", "netWeight", "650.00 KGS");
    await s.confirm(asha, "PACKING_LIST", "quantity", 1);
    await s.query(asha, ["CC-05"], "Packing list page 2 is unreadable. Please confirm the number of cartons shipped (the B/L says 25).");
  },
};
