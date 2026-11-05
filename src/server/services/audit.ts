import "server-only";
import type { Tx } from "../db/client";
import { auditLogs } from "../db/schema";

// ARCHITECTURE §4.4. Field-level edits are recorded in field_edits instead.
export type AuditAction =
  | "SHIPMENT_CREATED" | "DOCUMENT_UPLOADED" | "DOCUMENT_SUPERSEDED"
  | "EXTRACTION_STARTED" | "EXTRACTION_SUCCEEDED" | "EXTRACTION_FAILED" | "EXTRACTION_FALLBACK_USED"
  | "PAGE_MARKED_UNREADABLE" | "WRONG_TYPE_DISMISSED"
  | "CHECK_RESOLVED" | "CHECK_REOPENED" | "IMPORTER_QUERY_SENT" | "HOLD_CLEARED"
  | "SUBMITTED" | "APPROVED" | "SENT_BACK" | "APPROVAL_INVALIDATED"
  | "EXPORTED" | "EXPORT_DOWNLOADED" | "REOPENED" | "PII_REVEALED" | "STATUS_CHANGED";

export interface AuditEntry {
  actorId: string | null; // null = system
  action: AuditAction;
  entityType: string;
  entityId: string;
  shipmentId?: string | null;
  /** Ids, codes and counts only — never document text, model output or personal data. */
  metadata?: Record<string, string | number | boolean | null>;
}

/** Append-only (invariant 5): there is no update or delete path for audit rows. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({ ...entry, shipmentId: entry.shipmentId ?? null, metadata: entry.metadata ?? {} });
}
