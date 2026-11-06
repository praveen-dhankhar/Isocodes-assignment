import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { DOC_LABEL, HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { formatFieldValue } from "@/lib/format";
import { db } from "../db/client";
import { extractedFields, fieldEdits, lineItems, shipments, user } from "../db/schema";

// S5 (PRD F4): what people changed, for the manager to read before approving.

export interface ApprovalEdit {
  fieldId: string | null;
  where: string; // "Packing list · Net weight (kg)" or "Invoice · line 1 · HSN / HS code"
  action: "CORRECT" | "MANUAL_ENTRY";
  aiValue: string; // display; "" when nothing was read
  humanValue: string; // display
  by: string;
  at: string; // ISO
}

const FIELD: Record<string, FieldDef> = { ...HEADER_FIELDS, ...LINE_FIELDS };

export async function getApprovalSummary(shipmentId: string) {
  const edits = await db()
    .select({ e: fieldEdits, lineNo: lineItems.lineNo, by: user.name })
    .from(fieldEdits)
    .leftJoin(extractedFields, eq(extractedFields.id, fieldEdits.fieldId))
    .leftJoin(lineItems, eq(lineItems.id, extractedFields.lineItemId))
    .leftJoin(user, eq(user.id, fieldEdits.userId))
    .where(eq(fieldEdits.shipmentId, shipmentId))
    .orderBy(asc(fieldEdits.createdAt));

  // The latest change per field: a value corrected twice is shown once, as it now stands.
  const latest = new Map<string, (typeof edits)[number]>();
  for (const row of edits) if (row.e.action !== "CONFIRM") latest.set(row.e.fieldId ?? row.e.id, row);
  const changes: ApprovalEdit[] = [...latest.values()].map(({ e, lineNo, by }) => {
    const def = FIELD[e.fieldKey];
    const kind = def?.kind ?? "TEXT";
    return {
      fieldId: e.fieldId,
      where: [DOC_LABEL[e.docType as DocType], lineNo ? `line ${lineNo}` : null, def?.label ?? e.fieldKey].filter(Boolean).join(" · "),
      action: e.action as ApprovalEdit["action"],
      aiValue: formatFieldValue(kind, e.originalAiValue),
      humanValue: formatFieldValue(kind, e.newValue),
      by: by ?? "Someone",
      at: e.createdAt.toISOString(),
    };
  });

  const [s] = await db().select({ submittedBy: shipments.submittedBy, submittedAt: shipments.submittedAt, approvedBy: shipments.approvedBy, approvedAt: shipments.approvedAt }).from(shipments).where(eq(shipments.id, shipmentId));
  const ids = [s?.submittedBy, s?.approvedBy].filter((x): x is string => Boolean(x));
  const names = new Map(ids.length === 0 ? [] : (await db().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.name]));
  return {
    corrections: changes.filter((c) => c.action === "CORRECT"),
    manualEntries: changes.filter((c) => c.action === "MANUAL_ENTRY"),
    confirmations: edits.filter((r) => r.e.action === "CONFIRM").length,
    submitted: s?.submittedBy ? { by: names.get(s.submittedBy) ?? "Someone", at: s.submittedAt?.toISOString() ?? null } : null,
    approved: s?.approvedBy ? { by: names.get(s.approvedBy) ?? "Someone", at: s.approvedAt?.toISOString() ?? null } : null,
  };
}
export type ApprovalSummary = Awaited<ReturnType<typeof getApprovalSummary>>;
