import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { DOC_LABEL, HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { formatFieldValue } from "@/lib/format";
import { db } from "../db/client";
import { crossCheckResults, documents, extractedFields, fieldEdits, shipments, suppliers, user } from "../db/schema";

// S7 (PRD §8.3, §2 metrics). Only CORRECT edits on AI-read values count as errors; manual entries, confirmations and
// accepted discrepancies do not. The population is APPROVED/EXPORTED shipments with LIVE extraction; recorded
// samples can be included (they are labelled, never mixed in silently).

const FIELD: Record<string, FieldDef> = { ...HEADER_FIELDS, ...LINE_FIELDS };
export const BUCKETS = [
  { label: "≥ 0.95", min: 0.95, max: Infinity },
  { label: "0.85–0.95", min: 0.85, max: 0.95 },
  { label: "0.50–0.85", min: 0.5, max: 0.85 },
  { label: "< 0.50", min: -Infinity, max: 0.5 },
] as const;

export interface Rate {
  key: string;
  label: string;
  total: number;
  corrected: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length === 0 ? null : s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

export async function getAccuracyReport({ includeSamples }: { includeSamples: boolean }) {
  const modes: Array<"LIVE" | "SAMPLE"> = includeSamples ? ["LIVE", "SAMPLE"] : ["LIVE"];
  const rows = await db()
    .select({ fieldId: extractedFields.id, key: extractedFields.fieldKey, docType: documents.docType, confidence: extractedFields.confidence, supplier: suppliers.name })
    .from(extractedFields)
    .innerJoin(documents, eq(documents.id, extractedFields.documentId))
    .innerJoin(shipments, eq(shipments.id, extractedFields.shipmentId))
    .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
    .where(and(inArray(shipments.status, ["APPROVED", "EXPORTED"]), inArray(documents.mode, modes), isNull(documents.supersededAt), isNotNull(extractedFields.originalAiValue)));
  const ids = rows.map((r) => r.fieldId);
  const corrected = new Set(
    ids.length === 0 ? [] : (await db().select({ id: fieldEdits.fieldId }).from(fieldEdits).where(and(eq(fieldEdits.action, "CORRECT"), inArray(fieldEdits.fieldId, ids)))).map((e) => e.id),
  );

  const group = (keyOf: (r: (typeof rows)[number]) => string, labelOf: (r: (typeof rows)[number]) => string): Rate[] => {
    const m = new Map<string, Rate>();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) ?? { key: k, label: labelOf(r), total: 0, corrected: 0 };
      g.total++;
      if (corrected.has(r.fieldId)) g.corrected++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.corrected / b.total - a.corrected / a.total || b.total - a.total);
  };
  const byField = group((r) => r.key, (r) => FIELD[r.key]?.label ?? r.key);
  const bySupplier = group((r) => r.supplier, (r) => r.supplier);
  const calibration = BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.confidence !== null && Number(r.confidence) >= b.min && Number(r.confidence) < b.max);
    return { key: b.label, label: b.label, total: inBucket.length, corrected: inBucket.filter((r) => corrected.has(r.fieldId)).length };
  });

  // A-22 review time over every submitted shipment opened in S4. On approved/exported shipments a FAIL check can only
  // remain as an accepted discrepancy (the gate), so those plus the corrected misreads are what review caught.
  const timed = await db()
    .select({ opened: shipments.firstOpenedAt, submitted: shipments.submittedAt })
    .from(shipments)
    .where(and(isNotNull(shipments.firstOpenedAt), isNotNull(shipments.submittedAt)));
  const minutes = timed.flatMap((t) => (t.opened && t.submitted && t.submitted > t.opened ? [(t.submitted.getTime() - t.opened.getTime()) / 60_000] : []));
  const caught = await db()
    .select({ resolution: crossCheckResults.resolution })
    .from(crossCheckResults)
    .innerJoin(shipments, eq(shipments.id, crossCheckResults.shipmentId))
    .where(and(eq(crossCheckResults.status, "FAIL"), inArray(shipments.status, ["APPROVED", "EXPORTED"])));

  const log = await db()
    .select({ e: fieldEdits, ref: shipments.ref, shipmentId: shipments.id, by: user.name })
    .from(fieldEdits)
    .innerJoin(shipments, eq(shipments.id, fieldEdits.shipmentId))
    .leftJoin(user, eq(user.id, fieldEdits.userId))
    .orderBy(desc(fieldEdits.createdAt))
    .limit(50);

  const total = rows.length;
  return {
    includeSamples,
    overall: { total, corrected: corrected.size },
    byField,
    bySupplier,
    calibration,
    reviewMinutes: { median: median(minutes), shipments: minutes.length },
    caught: { accepted: caught.filter((c) => c.resolution === "DISCREPANCY_ACCEPTED").length },
    log: log.map(({ e, ref, shipmentId, by }) => {
      const kind = FIELD[e.fieldKey]?.kind ?? "TEXT";
      return {
        id: e.id, ref, shipmentId, where: `${DOC_LABEL[e.docType as DocType]} · ${FIELD[e.fieldKey]?.label ?? e.fieldKey}`, action: e.action,
        from: formatFieldValue(kind, e.previousValue), to: formatFieldValue(kind, e.newValue), ai: formatFieldValue(kind, e.originalAiValue), by: by ?? "Someone", at: e.createdAt.toISOString(),
      };
    }),
  };
}
export type AccuracyReport = Awaited<ReturnType<typeof getAccuracyReport>>;
