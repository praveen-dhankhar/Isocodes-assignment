import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { needsReview } from "@/domain/confidence";
import type { DocType } from "@/domain/fields";
import { SAMPLES } from "../../../scripts/sample-data";
import { approveShipment } from "../services/approval";
import { exportShipment } from "../services/export";
import { raiseImporterQuery } from "../services/resolutions";
import { confirmField, setFieldValue, submitForApproval } from "../services/review";
import { db } from "./client";
import { auditLogs, crossCheckResults, documentPages, documents, extractedFields, fieldEdits, lineItems, shipments } from "./schema";

// PLAN M8.4 / M9.4: the human part of the seeded history, done through the same services the screens call. A person
// reviews the way the screen asks: where the model's value differs from the document (the manifest's ground truth),
// they type what is printed (a CORRECT edit); where it is right but uncertain, they confirm it. So S7 and S8 show the
// model's real mistakes, whatever the fixtures (recorded or hand-authored) contain.

export interface Person {
  id: string;
  role: "DOCUMENTATION_EXECUTIVE" | "DOCUMENTATION_MANAGER";
}

const Truth = z.object({ header: z.record(z.string(), z.string().nullable()), lines: z.array(z.record(z.string(), z.string().nullable())) });
const Manifest = z.object({ samples: z.array(z.object({ ref: z.string(), documents: z.array(z.object({ docType: z.string(), truth: Truth })) })) });
let manifest: z.infer<typeof Manifest> | undefined;
const truthOf = (ref: string, docType: DocType) => {
  manifest ??= Manifest.parse(JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/samples/manifest.json"), "utf8")));
  return manifest.samples.find((s) => s.ref === ref)?.documents.find((d) => d.docType === docType)?.truth;
};
/** What the document prints for a field (what a person would type), from scripts/sample-data.ts. */
const printedOf = (ref: string, docType: DocType, key: string, lineNo: number | null) => {
  const doc = SAMPLES.find((s) => s.ref === ref)?.documents.find((d) => d.docType === docType);
  const cells: Record<string, string | undefined> | undefined = lineNo === null ? doc?.header : doc?.lines[lineNo - 1];
  return cells?.[key];
};

const version = async (shipmentId: string) => (await db().select({ v: shipments.version }).from(shipments).where(eq(shipments.id, shipmentId)))[0]?.v ?? 0;

async function fieldsOf(shipmentId: string) {
  return db()
    .select({ f: extractedFields, docType: documents.docType, lineNo: lineItems.lineNo, readable: documentPages.readable })
    .from(extractedFields)
    .innerJoin(documents, eq(documents.id, extractedFields.documentId))
    .leftJoin(lineItems, eq(lineItems.id, extractedFields.lineItemId))
    .leftJoin(documentPages, and(eq(documentPages.documentId, extractedFields.documentId), eq(documentPages.pageNo, extractedFields.pageNo)))
    .where(and(eq(extractedFields.shipmentId, shipmentId), isNull(documents.supersededAt)));
}

export function steps(shipmentId: string, ref: string) {
  const issues = async () => (await db().select({ n: shipments.unresolvedIssuesCount }).from(shipments).where(eq(shipments.id, shipmentId)))[0]?.n ?? 0;
  const state = async () => (await db().select({ s: shipments.status }).from(shipments).where(eq(shipments.id, shipmentId)))[0]?.s;
  return {
    /**
     * Review every value against the document: correct misreads, confirm uncertain values that are right. Values on an
     * unreadable page are typed in only when listed in `enter` (the rest stay open, as on SHP-24818).
     */
    review: async (who: Person, enter: string[] = []) => {
      for (const { f, docType, lineNo, readable } of await fieldsOf(shipmentId)) {
        const line = f.lineItemId ? lineNo : null;
        const truth = truthOf(ref, docType);
        const expected = (line === null ? truth?.header[f.fieldKey] : truth?.lines[(line ?? 1) - 1]?.[f.fieldKey]) ?? null;
        const printed = printedOf(ref, docType, f.fieldKey, line);
        if (f.status !== "UNREVIEWED") continue;
        if (expected !== null && f.value !== expected) {
          if (printed === undefined || (readable === false && !enter.includes(f.fieldKey))) continue;
          await setFieldValue({ fieldId: f.id, expectedFieldVersion: f.version, input: printed, actorId: who.id });
        } else if (f.value !== null && f.value === expected && needsReview(f.confidence === null ? null : Number(f.confidence))) {
          await confirmField({ fieldId: f.id, expectedFieldVersion: f.version, actorId: who.id });
        }
        // A value the document doesn't print (expected null) is left for a person to judge; it keeps blocking if uncertain.
      }
    },
    /** Each step acts only from the state it expects: a seed never forces a state the data doesn't support. */
    submit: async (who: Person) =>
      (await state()) === "EXTRACTED" && (await issues()) === 0 ? submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: who }) : null,
    /** Approve, acknowledging every accepted discrepancy (none on the seeded shipments that get this far). */
    approve: async (who: Person) =>
      (await state()) === "READY_FOR_APPROVAL" ? approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: who }) : null,
    export: async (who: Person) => ((await state()) === "APPROVED" ? exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: who }) : null),
    query: async (who: Person, ruleIds: string[], message: string) => {
      const checks = await db().select({ id: crossCheckResults.id, ruleId: crossCheckResults.ruleId, status: crossCheckResults.status }).from(crossCheckResults).where(eq(crossCheckResults.shipmentId, shipmentId));
      const checkIds = checks.filter((c) => ruleIds.includes(c.ruleId) && (c.status === "FAIL" || c.status === "INCOMPLETE")).map((c) => c.id);
      if (checkIds.length > 0) await raiseImporterQuery({ shipmentId, expectedVersion: await version(shipmentId), checkIds, message, actor: who });
    },
  };
}

/** A scenario runs once: a shipment someone has edited or moved on (submitted, queried…) is left alone. */
export async function touchedByPeople(shipmentId: string): Promise<boolean> {
  const [edits] = await db().select({ n: sql<number>`count(*)::int` }).from(fieldEdits).where(eq(fieldEdits.shipmentId, shipmentId));
  const [moved] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.shipmentId, shipmentId), inArray(auditLogs.action, ["SUBMITTED", "IMPORTER_QUERY_SENT", "CHECK_RESOLVED"])));
  return (edits?.n ?? 0) + (moved?.n ?? 0) > 0;
}

/**
 * API_SPECS §7.2 targets: SHP-24813 → APPROVED; SHP-24816 → EXPORTED; SHP-24817 → READY_FOR_APPROVAL;
 * SHP-24818 → ON_HOLD. SHP-24811/24812/24814/24815/24819 are left for people to try. Meera approves what Asha or
 * Vikram submitted (A-14).
 */
export const HUMAN_SCENARIOS: Record<string, (s: ReturnType<typeof steps>, people: { asha: Person; vikram: Person; meera: Person }) => Promise<unknown>> = {
  "SHP-24813": async (s, { asha, meera }) => {
    await s.review(asha);
    if (await s.submit(asha)) await s.approve(meera);
  },
  "SHP-24816": async (s, { asha, vikram, meera }) => {
    await s.review(asha);
    if (await s.submit(vikram)) {
      await s.approve(meera);
      await s.export(meera);
    }
  },
  "SHP-24817": async (s, { vikram }) => {
    await s.review(vikram);
    await s.submit(vikram);
  },
  "SHP-24818": async (s, { asha }) => {
    // Packing list page 2 is a blurred scan: the weights were typed from the supplier's copy; the cartons were not legible.
    await s.review(asha, ["grossWeight", "netWeight"]);
    await s.query(asha, ["CC-05"], "Packing list page 2 is unreadable. Please confirm the number of cartons shipped (the B/L says 25).");
  },
};
