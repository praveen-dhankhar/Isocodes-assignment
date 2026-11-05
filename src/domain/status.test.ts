import { describe, expect, it } from "vitest";
import { shp24811 } from "./checks/__fixtures__/snapshots";
import type { ShipmentSnapshot, ShipmentStatus } from "./snapshot";
import {
  canExport,
  deriveReviewStatus,
  nextStatusAfterDataChange,
  transition,
  type DerivedStatus,
  type TransitionAction,
  type TransitionContext,
} from "./status";

const docs = (change: (s: ShipmentSnapshot) => void) => {
  const snap = shp24811();
  change(snap);
  return snap;
};

describe("deriveReviewStatus (ARCHITECTURE §5)", () => {
  it.each<[string, ShipmentSnapshot, number, string]>([
    ["all extracted, nothing open", shp24811(), 0, "EXTRACTED"],
    ["all extracted, issues open", shp24811(), 1, "NEEDS_REVIEW"],
    ["one still extracting", docs((s) => { if (s.documents.PACKING_LIST) s.documents.PACKING_LIST.status = "EXTRACTING"; }), 3, "EXTRACTING"],
    ["one slot empty", docs((s) => delete s.documents.BILL_OF_LADING), 1, "DRAFT"],
    ["one failed", docs((s) => { if (s.documents.INVOICE) s.documents.INVOICE.status = "FAILED"; }), 1, "DRAFT"],
    ["one only uploaded", docs((s) => { if (s.documents.INVOICE) s.documents.INVOICE.status = "UPLOADED"; }), 1, "DRAFT"],
    ["manual entry counts as ready", docs((s) => { if (s.documents.INVOICE) s.documents.INVOICE.status = "MANUAL"; }), 0, "EXTRACTED"],
  ])("%s → %s", (_, snap, unresolved, expected) => {
    expect(deriveReviewStatus(snap, unresolved)).toBe(expected);
  });
});

describe("nextStatusAfterDataChange (PRD §10.2)", () => {
  it.each<[ShipmentStatus, DerivedStatus, ShipmentStatus, boolean]>([
    // current, freshly derived, next, approval invalidated
    ["NEEDS_REVIEW", "EXTRACTED", "EXTRACTED", false],
    ["EXTRACTED", "NEEDS_REVIEW", "NEEDS_REVIEW", false],
    ["DRAFT", "EXTRACTING", "EXTRACTING", false],
    ["READY_FOR_APPROVAL", "NEEDS_REVIEW", "NEEDS_REVIEW", true],
    ["APPROVED", "EXTRACTED", "EXTRACTED", true],
    ["ON_HOLD", "NEEDS_REVIEW", "ON_HOLD", false],
  ])("%s, derived %s → %s (approval invalidated: %s)", (current, derived, status, approvalInvalidated) => {
    expect(nextStatusAfterDataChange(current, derived)).toEqual({ ok: true, data: { status, approvalInvalidated } });
  });

  it("refuses to change an exported shipment until it is reopened", () => {
    expect(nextStatusAfterDataChange("EXPORTED", "EXTRACTED")).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
  });
});

const manager = { id: "meera", role: "DOCUMENTATION_MANAGER" } as const;
const executive = { id: "asha", role: "DOCUMENTATION_EXECUTIVE" } as const;
const ctx = (overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: executive,
  derived: "EXTRACTED",
  unresolved: 0,
  submittedBy: "asha",
  discrepanciesAcknowledged: true,
  ...overrides,
});

describe("transition (PRD §10.2–10.3, §11)", () => {
  it.each<[string, ShipmentStatus, TransitionAction, Partial<TransitionContext>, string]>([
    // case, current, action, context, resulting status or error code
    ["submit a clean shipment", "EXTRACTED", "submit", {}, "READY_FOR_APPROVAL"],
    ["submit with issues open", "NEEDS_REVIEW", "submit", { unresolved: 2 }, "INVALID_STATE"],
    ["submit while on hold", "ON_HOLD", "submit", {}, "INVALID_STATE"],
    ["manager approves another's submission", "READY_FOR_APPROVAL", "approve", { actor: manager }, "APPROVED"],
    ["executive cannot approve", "READY_FOR_APPROVAL", "approve", {}, "FORBIDDEN"],
    ["manager cannot approve own submission", "READY_FOR_APPROVAL", "approve", { actor: manager, submittedBy: "meera" }, "SELF_APPROVAL_FORBIDDEN"],
    ["approve with issues open", "READY_FOR_APPROVAL", "approve", { actor: manager, unresolved: 1 }, "INVALID_STATE"],
    ["approve without ticking discrepancies", "READY_FOR_APPROVAL", "approve", { actor: manager, discrepanciesAcknowledged: false }, "VALIDATION_FAILED"],
    ["approve from the wrong status", "EXTRACTED", "approve", { actor: manager }, "INVALID_STATE"],
    ["send back re-derives", "READY_FOR_APPROVAL", "sendBack", { actor: manager, derived: "EXTRACTED" }, "EXTRACTED"],
    ["executive cannot send back", "READY_FOR_APPROVAL", "sendBack", {}, "FORBIDDEN"],
    ["send back from the wrong status", "APPROVED", "sendBack", { actor: manager }, "INVALID_STATE"],
    ["export an approved shipment", "APPROVED", "export", {}, "EXPORTED"],
    ["export before approval", "READY_FOR_APPROVAL", "export", {}, "INVALID_STATE"],
    ["query importer while reviewing", "NEEDS_REVIEW", "raiseQuery", {}, "ON_HOLD"],
    ["query importer when extracted", "EXTRACTED", "raiseQuery", {}, "ON_HOLD"],
    ["query importer after submit", "READY_FOR_APPROVAL", "raiseQuery", {}, "INVALID_STATE"],
    ["resume re-derives", "ON_HOLD", "resume", { derived: "NEEDS_REVIEW" }, "NEEDS_REVIEW"],
    ["resume when not on hold", "NEEDS_REVIEW", "resume", {}, "INVALID_STATE"],
    ["manager reopens an export", "EXPORTED", "reopen", { actor: manager, derived: "EXTRACTED" }, "EXTRACTED"],
    ["manager reopens an approval", "APPROVED", "reopen", { actor: manager, derived: "EXTRACTED" }, "EXTRACTED"],
    ["executive cannot reopen", "EXPORTED", "reopen", {}, "FORBIDDEN"],
    ["nothing to reopen", "NEEDS_REVIEW", "reopen", { actor: manager }, "INVALID_STATE"],
  ])("%s", (_, current, action, overrides, expected) => {
    const result = transition(current, action, ctx(overrides));
    expect(result.ok ? result.data : result.error.code).toBe(expected);
  });
});

describe("canExport (PRD §10.3 gate 3)", () => {
  const approved = docs((s) => { s.status = "APPROVED"; });
  const at = (iso: string) => new Date(iso);

  it.each<[string, ShipmentSnapshot, number, { approvedAt: Date | null; lastDataChangeAt?: Date }, string[]]>([
    ["approved, clean, unchanged", approved, 0, { approvedAt: at("2026-10-20T10:00:00Z"), lastDataChangeAt: at("2026-10-20T09:00:00Z") }, []],
    ["SHP-24811 as seeded", shp24811(), 1, { approvedAt: null }, ["WRONG_STATUS", "NOT_APPROVED", "UNRESOLVED_ISSUES"]],
    ["issues reopened after approval", approved, 1, { approvedAt: at("2026-10-20T10:00:00Z"), lastDataChangeAt: at("2026-10-20T09:00:00Z") }, ["UNRESOLVED_ISSUES"]],
    ["last change unknown: fails closed", approved, 0, { approvedAt: at("2026-10-20T10:00:00Z") }, ["CHANGED_AFTER_APPROVAL"]],
    ["data changed after approval", approved, 0, { approvedAt: at("2026-10-20T10:00:00Z"), lastDataChangeAt: at("2026-10-20T10:05:00Z") }, ["CHANGED_AFTER_APPROVAL"]],
    ["status says approved but no approval recorded", approved, 0, { approvedAt: null }, ["NOT_APPROVED"]],
  ])("%s", (_, snap, unresolved, context, reasons) => {
    const issues = Array.from({ length: unresolved }, () => ({ type: "CHECK_FAILED" as const, ref: {}, label: "x" }));
    const result = canExport(snap, issues, context);
    expect(result.ok ? [] : result.reasons).toEqual(reasons);
  });
});
