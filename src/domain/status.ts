import { DocType } from "./fields";
import type { BlockingIssue } from "./issues";
import type { ShipmentSnapshot, ShipmentStatus } from "./snapshot";

/** Computed, never set by hand (PRD §10.2). The rest of ShipmentStatus changes only through `transition`. */
export type DerivedStatus = "DRAFT" | "EXTRACTING" | "NEEDS_REVIEW" | "EXTRACTED";
export type Role = "DOCUMENTATION_EXECUTIVE" | "DOCUMENTATION_MANAGER";
export type ExportBlockReason = "NOT_APPROVED" | "UNRESOLVED_ISSUES" | "CHANGED_AFTER_APPROVAL" | "WRONG_STATUS";

/** Codes are the API's (API_SPECS §1.2), named here so the domain needs nothing from src/lib. */
export interface DomainError {
  code: "INVALID_STATE" | "FORBIDDEN" | "SELF_APPROVAL_FORBIDDEN" | "VALIDATION_FAILED";
  message: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: DomainError };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: DomainError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

export function deriveReviewStatus(snapshot: ShipmentSnapshot, unresolved: number): DerivedStatus {
  const docs = DocType.options.map((t) => snapshot.documents[t]);
  if (docs.some((d) => d?.status === "EXTRACTING")) return "EXTRACTING";
  if (docs.some((d) => !d || (d.status !== "EXTRACTED" && d.status !== "MANUAL"))) return "DRAFT";
  return unresolved > 0 ? "NEEDS_REVIEW" : "EXTRACTED";
}

/** Any data change: approval is invalidated and status re-derived; on hold stays on hold; exported is read-only. */
export function nextStatusAfterDataChange(
  current: ShipmentStatus,
  derived: DerivedStatus,
): Result<{ status: ShipmentStatus; approvalInvalidated: boolean }> {
  switch (current) {
    case "EXPORTED":
      return fail("INVALID_STATE", "Exported shipments are read-only until a manager reopens them");
    case "ON_HOLD":
      return ok({ status: "ON_HOLD", approvalInvalidated: false });
    case "READY_FOR_APPROVAL":
    case "APPROVED":
      return ok({ status: derived, approvalInvalidated: true });
    default:
      return ok({ status: derived, approvalInvalidated: false });
  }
}

export type TransitionAction = "submit" | "approve" | "sendBack" | "export" | "raiseQuery" | "resume" | "reopen";

export interface TransitionContext {
  actor: { id: string; role: Role };
  derived: DerivedStatus; // deriveReviewStatus now, for actions that hand status back to the data
  unresolved: number;
  submittedBy: string | null;
  discrepanciesAcknowledged: boolean; // the approver ticked every DISCREPANCY_ACCEPTED check
}

// PRD §10.2 (allowed starting states) and §11 (manager-only actions).
const ALLOWED: Record<TransitionAction, { from: readonly ShipmentStatus[]; managerOnly: boolean }> = {
  submit: { from: ["EXTRACTED"], managerOnly: false },
  approve: { from: ["READY_FOR_APPROVAL"], managerOnly: true },
  sendBack: { from: ["READY_FOR_APPROVAL"], managerOnly: true },
  export: { from: ["APPROVED"], managerOnly: false },
  raiseQuery: { from: ["NEEDS_REVIEW", "EXTRACTED"], managerOnly: false },
  resume: { from: ["ON_HOLD"], managerOnly: false },
  reopen: { from: ["APPROVED", "EXPORTED"], managerOnly: true }, // F8: status is re-derived
};

/** Human status changes (PRD §10.2–10.3). Export also needs `canExport`, checked inside the export transaction. */
export function transition(current: ShipmentStatus, action: TransitionAction, ctx: TransitionContext): Result<ShipmentStatus> {
  const rule = ALLOWED[action];
  if (rule.managerOnly && ctx.actor.role !== "DOCUMENTATION_MANAGER") return fail("FORBIDDEN", `Only a manager can ${action} a shipment`);
  if (!rule.from.includes(current)) return fail("INVALID_STATE", `Cannot ${action} a shipment that is ${current}`);
  const issuesOpen = () => fail("INVALID_STATE", `${ctx.unresolved} unresolved issue(s) remain`);

  switch (action) {
    case "submit":
      return ctx.unresolved > 0 ? issuesOpen() : ok("READY_FOR_APPROVAL");
    case "approve":
      if (ctx.submittedBy === ctx.actor.id) return fail("SELF_APPROVAL_FORBIDDEN", "Another manager must approve a shipment you submitted (A-14)");
      if (ctx.unresolved > 0) return issuesOpen();
      if (!ctx.discrepanciesAcknowledged) return fail("VALIDATION_FAILED", "Acknowledge every accepted discrepancy before approving");
      return ok("APPROVED");
    case "export":
      return ok("EXPORTED");
    case "raiseQuery":
      return ok("ON_HOLD");
    case "sendBack":
    case "resume":
    case "reopen":
      return ok(ctx.derived);
  }
}

/**
 * PRD §10.3 gate 3, re-run inside the export transaction. Fails closed: with an approval but no known
 * last-change time, the data counts as changed after approval.
 */
export function canExport(
  snapshot: ShipmentSnapshot,
  issues: readonly BlockingIssue[],
  ctx: { approvedAt: Date | null; lastDataChangeAt?: Date },
): { ok: true } | { ok: false; reasons: ExportBlockReason[] } {
  const reasons: ExportBlockReason[] = [];
  if (snapshot.status !== "APPROVED") reasons.push("WRONG_STATUS");
  if (ctx.approvedAt === null) reasons.push("NOT_APPROVED");
  if (issues.length > 0) reasons.push("UNRESOLVED_ISSUES");
  if (ctx.approvedAt !== null && !(ctx.lastDataChangeAt && ctx.lastDataChangeAt.getTime() <= ctx.approvedAt.getTime())) {
    reasons.push("CHANGED_AFTER_APPROVAL");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
