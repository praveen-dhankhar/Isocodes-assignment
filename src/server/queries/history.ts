import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { DOC_LABEL, HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { formatFieldValue } from "@/lib/format";
import { db } from "../db/client";
import { auditLogs, fieldEdits, user } from "../db/schema";

// S8: one timeline from audit_logs (what happened to the shipment) and field_edits (what happened to values).

const FIELD: Record<string, FieldDef> = { ...HEADER_FIELDS, ...LINE_FIELDS };

const SENTENCE: Record<string, string> = {
  SHIPMENT_CREATED: "created the shipment", DOCUMENT_UPLOADED: "uploaded a document", DOCUMENT_SUPERSEDED: "replaced a document",
  EXTRACTION_STARTED: "started extraction", EXTRACTION_SUCCEEDED: "extraction finished", EXTRACTION_FAILED: "extraction failed",
  EXTRACTION_FALLBACK_USED: "extraction used the fallback model", PAGE_MARKED_UNREADABLE: "marked a page unreadable",
  WRONG_TYPE_DISMISSED: "kept a document in its slot despite the detected type", CHECK_RESOLVED: "resolved a check", CHECK_REOPENED: "a check re-opened",
  IMPORTER_QUERY_SENT: "queried the importer", HOLD_CLEARED: "resumed from hold", SUBMITTED: "submitted for approval", APPROVED: "approved",
  SENT_BACK: "sent it back", APPROVAL_INVALIDATED: "approval was invalidated by a change", EXPORTED: "exported CF-1", EXPORT_DOWNLOADED: "downloaded an export again",
  REOPENED: "reopened it", PII_REVEALED: "revealed the importer's contact", STATUS_CHANGED: "status changed",
};
const EDIT: Record<string, string> = { CONFIRM: "confirmed", CORRECT: "corrected", MANUAL_ENTRY: "entered" };
const DETAIL_KEYS = ["ruleId", "scope", "resolution", "from", "to", "note", "reason", "code", "pageNo", "rows"] as const;

export interface HistoryEvent {
  id: string;
  at: string; // ISO
  actor: string; // "System" when no person
  text: string;
  detail: string | null; // ids and codes from metadata, or "AI read X → Y" for an edit; user notes as written
}

export async function getShipmentHistory(shipmentId: string): Promise<HistoryEvent[]> {
  const [logs, edits] = await Promise.all([
    db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId)).orderBy(desc(auditLogs.createdAt)),
    db().select().from(fieldEdits).where(eq(fieldEdits.shipmentId, shipmentId)).orderBy(desc(fieldEdits.createdAt)),
  ]);
  const ids = [...new Set([...logs.map((l) => l.actorId), ...edits.map((e) => e.userId)].filter((x): x is string => Boolean(x)))];
  const names = new Map(ids.length === 0 ? [] : (await db().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.name]));

  const events: HistoryEvent[] = [
    ...logs.map((l) => {
      const meta = (l.metadata ?? {}) as Record<string, unknown>;
      const detail = DETAIL_KEYS.flatMap((k) => (meta[k] === undefined || meta[k] === null ? [] : [k === "note" || k === "reason" ? `“${String(meta[k])}”` : `${k} ${String(meta[k])}`])).join(" · ");
      return { id: `a${l.id}`, at: l.createdAt.toISOString(), actor: l.actorId ? (names.get(l.actorId) ?? "Someone") : "System", text: SENTENCE[l.action] ?? l.action, detail: detail || null };
    }),
    ...edits.map((e) => {
      const kind = FIELD[e.fieldKey]?.kind ?? "TEXT";
      const where = `${DOC_LABEL[e.docType as DocType]} · ${FIELD[e.fieldKey]?.label ?? e.fieldKey}`;
      const ai = formatFieldValue(kind, e.originalAiValue);
      return {
        id: `e${e.id}`, at: e.createdAt.toISOString(), actor: names.get(e.userId) ?? "Someone", text: `${EDIT[e.action] ?? e.action} ${where}`,
        detail: e.action === "CONFIRM" ? formatFieldValue(kind, e.newValue) : `AI read ${ai || "nothing"} → ${formatFieldValue(kind, e.newValue)}`,
      };
    }),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at));
}
