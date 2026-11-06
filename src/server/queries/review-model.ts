import "server-only";
import { eq, inArray } from "drizzle-orm";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { runCrossChecks } from "@/domain/checks/run-checks";
import { RULE_NAME, type CheckResolution, type CheckSeverity, type CheckStatus, type ObservedValue, type RuleId } from "@/domain/checks/types";
import type { ConfidenceSignals } from "@/domain/confidence";
import type { Box } from "@/domain/evidence";
import { DocType, HEADER_FIELDS, LINE_FIELDS, type FieldDef, type FieldKind } from "@/domain/fields";
import { computeBlockingIssues, type BlockingIssueType } from "@/domain/issues";
import { canExport, type Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { formatFieldValue } from "@/lib/format";
import { maskEmail } from "@/lib/pii";
import { db } from "../db/client";
import { crossCheckResults, documentPages, extractedFields, importers, lineItems, shipments, suppliers, user } from "../db/schema";
import { loadSnapshot } from "../services/snapshot";
import type { SessionUser } from "../session";
import { shipmentStatus, type ShipmentStatusDTO } from "./shipments";

// API_SPECS §3 ReviewModel: everything S4 (and S5) render, built in one place on the server.

export interface FieldDTO {
  id: string;
  documentId: string;
  docType: DocType;
  lineNo: number | null;
  fieldKey: string;
  label: string;
  kind: FieldKind;
  rawText: string | null; // as printed; untrusted, rendered as text only
  value: string | null;
  display: string;
  originalAiValue: string | null;
  isConfirmedByHuman: boolean;
  status: "UNREVIEWED" | "CONFIRMED" | "CORRECTED" | "MANUAL";
  confidence: number | null;
  signals: ConfidenceSignals | null;
  needsReview: boolean;
  pageNo: number | null;
  bbox: Box | null;
  version: number;
}

export interface CheckDTO {
  id: string;
  ruleId: RuleId;
  ruleName: string;
  scope: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  notes: string[];
  observed: ObservedValue[];
  delta: string | null;
  resolution: CheckResolution | null;
  declaredValue: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null; // display name
  resolvedAt: string | null;
  acknowledgedBy: string | null; // display name
}

export interface PageDTO {
  pageNo: number;
  url: string;
  width: number;
  height: number;
  readable: boolean | null;
  issues: string[];
}

export interface IssueDTO {
  type: BlockingIssueType;
  label: string;
  fieldId?: string;
  checkId?: string;
  documentId?: string;
}

export interface ReviewModel {
  shipment: ShipmentStatusDTO & {
    importer: { id: string; name: string; iec: string; contactMasked: string };
    supplier: { id: string; name: string; countryCode: string };
    submittedBy: string | null;
  };
  pages: Record<DocType, PageDTO[]>;
  fields: FieldDTO[];
  checks: CheckDTO[];
  issues: IssueDTO[];
  viewer: { userId: string; role: Role; canApprove: boolean; canExport: boolean };
}

const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;
const SLOT = Object.fromEntries(DocType.options.map((d, i) => [d, i])) as Record<DocType, number>;
const order = (registry: Record<string, FieldDef>, key: string) => Object.keys(registry).indexOf(key);
const scopeOrder = (scope: string) => (scope === "shipment" ? 0 : Number(scope.split(":")[1] ?? 0));

/** One stored field as the UI sees it; `needsReview` comes from the blocking-issue list. */
export function toFieldDTO(f: typeof extractedFields.$inferSelect, docType: DocType, lineNo: number | null, needsReview: boolean): FieldDTO | null {
  const def = (f.lineItemId ? LINE : HEADER)[f.fieldKey];
  if (!def) return null;
  return {
    id: f.id, documentId: f.documentId, docType, lineNo: f.lineItemId ? lineNo : null, fieldKey: f.fieldKey, label: def.label,
    kind: def.kind, rawText: f.rawText, value: f.value, display: formatFieldValue(def.kind, f.value), originalAiValue: f.originalAiValue,
    isConfirmedByHuman: f.status !== "UNREVIEWED", status: f.status, confidence: f.confidence === null ? null : Number(f.confidence),
    signals: (f.confidenceSignals ?? null) as ConfidenceSignals | null, needsReview, pageNo: f.pageNo, bbox: (f.bbox ?? null) as Box | null, version: f.version,
  };
}

export async function getReviewModel(shipmentId: string, viewer: SessionUser): Promise<ReviewModel> {
  const [head] = await db()
    .select({ s: shipments, importer: importers, supplier: suppliers })
    .from(shipments)
    .innerJoin(importers, eq(importers.id, shipments.importerId))
    .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
    .where(eq(shipments.id, shipmentId));
  if (!head) throw new AppError("NOT_FOUND", "Shipment not found");

  const [status, snapshot] = await Promise.all([shipmentStatus(db(), shipmentId), loadSnapshot(db(), shipmentId, { lock: false })]);
  const docIds = status.documents.map((d) => d.id);
  const docType = new Map(status.documents.map((d) => [d.id, d.docType]));

  const [pageRows, fieldRows, checkRows] = await Promise.all([
    docIds.length === 0 ? [] : db().select().from(documentPages).where(inArray(documentPages.documentId, docIds)),
    docIds.length === 0
      ? []
      : db()
          .select({ f: extractedFields, lineNo: lineItems.lineNo })
          .from(extractedFields)
          .leftJoin(lineItems, eq(lineItems.id, extractedFields.lineItemId))
          .where(inArray(extractedFields.documentId, docIds)),
    db().select().from(crossCheckResults).where(eq(crossCheckResults.shipmentId, shipmentId)),
  ]);

  // The engine is pure and cheap: re-running it gives the same outcomes recompute stored, plus the issue list.
  const issues = computeBlockingIssues(snapshot, runCrossChecks(snapshot, CHECK_CONFIG));
  const blockedFields = new Set(issues.flatMap((i) => (i.type === "FIELD_NEEDS_REVIEW" && i.ref.fieldId ? [i.ref.fieldId] : [])));
  const checkId = (ruleId?: string, scope?: string) => checkRows.find((c) => c.ruleId === ruleId && c.scope === scope)?.id;

  const people = [...new Set(checkRows.flatMap((c) => [c.resolvedBy, c.acknowledgedBy]).filter((id): id is string => id !== null))];
  const names = new Map(people.length === 0 ? [] : (await db().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, people))).map((u) => [u.id, u.name]));

  const pages = Object.fromEntries(DocType.options.map((d) => [d, [] as PageDTO[]])) as Record<DocType, PageDTO[]>;
  for (const p of pageRows.sort((a, b) => a.pageNo - b.pageNo)) {
    const d = docType.get(p.documentId);
    if (d) pages[d].push({ pageNo: p.pageNo, url: `/api/documents/${p.documentId}/pages/${p.pageNo}`, width: p.width, height: p.height, readable: p.readable, issues: p.issues });
  }

  const fields: FieldDTO[] = fieldRows
    .flatMap(({ f, lineNo }) => {
      const d = docType.get(f.documentId);
      const dto = d ? toFieldDTO(f, d, lineNo, blockedFields.has(f.id)) : null;
      return dto ? [dto] : [];
    })
    .sort((a, b) =>
      SLOT[a.docType] - SLOT[b.docType] || (a.lineNo ?? 0) - (b.lineNo ?? 0) ||
      order(a.lineNo === null ? HEADER : LINE, a.fieldKey) - order(b.lineNo === null ? HEADER : LINE, b.fieldKey),
    );

  const checks: CheckDTO[] = checkRows
    .map((c) => ({
      id: c.id, ruleId: c.ruleId as RuleId, ruleName: RULE_NAME[c.ruleId as RuleId], scope: c.scope, status: c.status, severity: c.severity,
      message: c.message, notes: (c.notes ?? []) as string[], observed: (c.observed ?? []) as ObservedValue[], delta: c.delta,
      resolution: c.resolution, declaredValue: c.declaredValue, resolutionNote: c.resolutionNote,
      resolvedBy: c.resolvedBy ? (names.get(c.resolvedBy) ?? "Someone") : null, resolvedAt: c.resolvedAt?.toISOString() ?? null,
      acknowledgedBy: c.acknowledgedBy ? (names.get(c.acknowledgedBy) ?? "Someone") : null,
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || scopeOrder(a.scope) - scopeOrder(b.scope));

  const s = head.s;
  const exportable = canExport(snapshot, issues, { approvedAt: s.approvedAt, lastDataChangeAt: s.lastDataChangeAt }).ok;
  return {
    shipment: {
      ...status,
      importer: { id: head.importer.id, name: head.importer.name, iec: head.importer.iec, contactMasked: maskEmail(head.importer.contactEmail) },
      supplier: { id: head.supplier.id, name: head.supplier.name, countryCode: head.supplier.countryCode },
      submittedBy: s.submittedBy,
    },
    pages,
    fields,
    checks,
    issues: issues.map((i) => ({
      type: i.type, label: i.label, fieldId: i.ref.fieldId, documentId: i.ref.documentId, checkId: checkId(i.ref.ruleId, i.ref.checkScope),
    })),
    viewer: {
      userId: viewer.id,
      role: viewer.role,
      canApprove: viewer.role === "DOCUMENTATION_MANAGER" && s.status === "READY_FOR_APPROVAL" && s.submittedBy !== viewer.id && issues.length === 0,
      canExport: exportable,
    },
  };
}
