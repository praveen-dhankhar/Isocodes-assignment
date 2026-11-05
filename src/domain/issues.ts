import type { CheckOutcome, RuleId } from "./checks/types";
import { needsReview } from "./confidence";
import { DOC_LABEL, DocType, HEADER_FIELDS, LINE_FIELDS, type FieldDef } from "./fields";
import type { FieldRef, ShipmentSnapshot } from "./snapshot";

export type BlockingIssueType =
  | "DOCUMENT_MISSING"
  | "DOCUMENT_NOT_READY"
  | "WRONG_DOCUMENT_TYPE"
  | "FIELD_NEEDS_REVIEW"
  | "CHECK_FAILED"
  | "CHECK_INCOMPLETE"
  | "IMPORTER_QUERY_OPEN";

export interface BlockingIssue {
  type: BlockingIssueType;
  ref: { documentId?: string; fieldId?: string; ruleId?: RuleId; checkScope?: string };
  label: string;
}

// The model's name for each slot type (API_SPECS §2.2) and how to say what it saw instead.
const DETECTED_AS: Record<DocType, string> = {
  INVOICE: "COMMERCIAL_INVOICE",
  PACKING_LIST: "PACKING_LIST",
  BILL_OF_LADING: "BILL_OF_LADING",
};
const SEEN_AS: Record<string, string> = {
  COMMERCIAL_INVOICE: "an invoice",
  PACKING_LIST: "a packing list",
  BILL_OF_LADING: "a bill of lading",
};
const NOT_READY: Record<string, string> = {
  UPLOADED: "not extracted yet",
  EXTRACTING: "extraction in progress",
  FAILED: "extraction failed",
};

// Registry rows by plain string key: Object.entries hands back strings.
const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;

const unverified = (ref: FieldRef) => ref.status === "UNREVIEWED" && needsReview(ref.confidence);

/**
 * PRD §10.1: everything that stops submit, approve and export; `unresolvedIssuesCount` is its length.
 * Ordered as the issues panel shows them (PRD §5.2 F3): documents, failed checks, fields to review, incomplete checks.
 */
export function computeBlockingIssues(snapshot: ShipmentSnapshot, outcomes: readonly CheckOutcome[]): BlockingIssue[] {
  const documents: BlockingIssue[] = [];
  const fields: BlockingIssue[] = [];

  for (const docType of DocType.options) {
    const doc = snapshot.documents[docType];
    const name = DOC_LABEL[docType];
    if (!doc) {
      documents.push({ type: "DOCUMENT_MISSING", ref: {}, label: `${name}: not uploaded` });
      continue;
    }
    const documentId = doc.documentId;
    const notReady = NOT_READY[doc.status];
    if (notReady) documents.push({ type: "DOCUMENT_NOT_READY", ref: { documentId }, label: `${name}: ${notReady}` });
    if (doc.detectedDocType !== null && doc.detectedDocType !== DETECTED_AS[docType] && !doc.wrongTypeDismissed) {
      const seen = SEEN_AS[doc.detectedDocType] ?? "another kind of document";
      documents.push({ type: "WRONG_DOCUMENT_TYPE", ref: { documentId }, label: `${name}: the file reads as ${seen}` });
    }

    const review = (ref: FieldRef, def: FieldDef | undefined, where: string) => {
      if (unverified(ref)) fields.push({ type: "FIELD_NEEDS_REVIEW", ref: { documentId, fieldId: ref.fieldId }, label: `${where}: ${def?.label ?? "Field"} needs review` });
    };
    for (const [key, ref] of Object.entries(doc.header)) review(ref, HEADER[key], name);
    for (const line of doc.lines) {
      for (const [key, ref] of Object.entries(line.cells)) review(ref, LINE[key], `${name} line ${line.lineNo}`);
    }
  }

  const check = (type: BlockingIssueType) => (o: CheckOutcome): BlockingIssue => ({
    type,
    ref: { ruleId: o.ruleId, checkScope: o.scope },
    label: `${o.ruleId}: ${o.message}`,
  });
  const failed = outcomes.filter((o) => o.status === "FAIL" && o.resolution?.type !== "DISCREPANCY_ACCEPTED").map(check("CHECK_FAILED"));
  const incomplete = outcomes.filter((o) => o.status === "INCOMPLETE" && o.resolution?.type !== "ACKNOWLEDGED_MISSING").map(check("CHECK_INCOMPLETE"));
  const hold: BlockingIssue[] = snapshot.status === "ON_HOLD" ? [{ type: "IMPORTER_QUERY_OPEN", ref: {}, label: "Waiting for the importer's reply" }] : [];

  return [...documents, ...failed, ...fields, ...incomplete, ...hold];
}
