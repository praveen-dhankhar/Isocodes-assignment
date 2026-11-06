import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RuleId } from "@/domain/checks/types";
import { RULE_FIELD } from "@/domain/export/precedence";
import { normalizeTyped } from "@/domain/normalize/field";
import { deriveReviewStatus, transition, type Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { db, type Tx } from "../db/client";
import { crossCheckResults, shipments, user } from "../db/schema";
import { toCheckDTO } from "../queries/review-model";
import { audit } from "./audit";
import { lockShipment, recomputeShipment } from "./recompute";
import { loadSnapshot } from "./snapshot";

// API_SPECS §5.2 check resolutions (PRD F3.4–F3.5, F6). A resolution is remembered with the check's fingerprint: it
// survives recomputes while the observed values stay the same and re-opens when they change (recompute.ts).

interface Actor {
  id: string;
  role: Role;
}

async function lockCheck(tx: Tx, checkId: string, expectedVersion: number) {
  const [check] = await tx.select().from(crossCheckResults).where(eq(crossCheckResults.id, checkId));
  if (!check) throw new AppError("NOT_FOUND", "Check not found");
  const shipment = await lockShipment(tx, check.shipmentId, expectedVersion);
  return { check, shipment };
}

async function resolved(tx: Tx, checkId: string, shipmentId: string, actorId: string) {
  const { version } = await recomputeShipment(tx, shipmentId, actorId);
  const [row] = await tx.select().from(crossCheckResults).where(eq(crossCheckResults.id, checkId));
  if (!row) throw new AppError("NOT_FOUND", "Check not found");
  const ids = [row.resolvedBy, row.acknowledgedBy].filter((x): x is string => x !== null);
  const names = new Map(ids.length === 0 ? [] : (await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.name]));
  return { check: toCheckDTO(row, names), shipmentVersion: version };
}

const resolve = (tx: Tx, checkId: string, values: Partial<typeof crossCheckResults.$inferInsert>) =>
  tx.update(crossCheckResults).set({ ...values, updatedAt: sql`now()` }).where(eq(crossCheckResults.id, checkId));

/** The documents really disagree and the user decides what to file. Only FAIL checks; the manager acknowledges it. */
export async function acceptDiscrepancy(input: { checkId: string; expectedVersion: number; declaredValue: string; note: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { check } = await lockCheck(tx, input.checkId, input.expectedVersion);
    if (check.status !== "FAIL") throw new AppError("INVALID_STATE", "Only a failed check can be accepted as a discrepancy");
    const { kind } = RULE_FIELD[check.ruleId as RuleId];
    // Typed on an en-IN screen (A-15): "." is the decimal mark.
    const declared = normalizeTyped(kind, input.declaredValue, { separator: ".", supplierCountry: null });
    if (declared.value === null) throw new AppError("VALIDATION_FAILED", `Couldn't read '${input.declaredValue}' as the value to declare`);
    await resolve(tx, check.id, {
      resolution: "DISCREPANCY_ACCEPTED", declaredValue: declared.value, resolutionNote: input.note, resolvedBy: input.actor.id, resolvedAt: new Date(), acknowledgedBy: null,
    });
    await audit(tx, { actorId: input.actor.id, action: "CHECK_RESOLVED", entityType: "cross_check_result", entityId: check.id, shipmentId: check.shipmentId, metadata: { ruleId: check.ruleId, scope: check.scope, resolution: "DISCREPANCY_ACCEPTED" } });
    return resolved(tx, check.id, check.shipmentId, input.actor.id);
  });
}

/** An INCOMPLETE check whose value is genuinely not on the document. Lines can't be acknowledged away (CC-02). */
export async function acknowledgeMissing(input: { checkId: string; expectedVersion: number; note: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { check } = await lockCheck(tx, input.checkId, input.expectedVersion);
    if (check.status !== "INCOMPLETE") throw new AppError("INVALID_STATE", "Only an incomplete check can be acknowledged");
    if (check.ruleId === "CC-02" && /no line items/i.test(check.message)) throw new AppError("INVALID_STATE", "Add the invoice lines instead; a total can't be checked without them");
    await resolve(tx, check.id, { resolution: "ACKNOWLEDGED_MISSING", declaredValue: null, resolutionNote: input.note, resolvedBy: input.actor.id, resolvedAt: new Date() });
    await audit(tx, { actorId: input.actor.id, action: "CHECK_RESOLVED", entityType: "cross_check_result", entityId: check.id, shipmentId: check.shipmentId, metadata: { ruleId: check.ruleId, scope: check.scope, resolution: "ACKNOWLEDGED_MISSING" } });
    return resolved(tx, check.id, check.shipmentId, input.actor.id);
  });
}

/** Undo a resolution: the check is open again. */
export async function clearResolution(input: { checkId: string; expectedVersion: number; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { check } = await lockCheck(tx, input.checkId, input.expectedVersion);
    if (!check.resolution) throw new AppError("INVALID_STATE", "This check has no resolution to undo");
    if (check.resolution === "QUERY_RAISED") throw new AppError("INVALID_STATE", "Resume the shipment to close the importer query");
    await resolve(tx, check.id, { resolution: null, declaredValue: null, resolutionNote: null, resolvedBy: null, resolvedAt: null, acknowledgedBy: null });
    await audit(tx, { actorId: input.actor.id, action: "CHECK_REOPENED", entityType: "cross_check_result", entityId: check.id, shipmentId: check.shipmentId, metadata: { ruleId: check.ruleId, scope: check.scope } });
    return resolved(tx, check.id, check.shipmentId, input.actor.id);
  });
}

/** Ask the importer (mock notification): the shipment goes ON_HOLD and the named checks carry the query. */
export async function raiseImporterQuery(input: { shipmentId: string; expectedVersion: number; checkIds: string[]; message: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const row = await lockShipment(tx, input.shipmentId, input.expectedVersion);
    const checks = await tx.select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, input.shipmentId), inArray(crossCheckResults.id, input.checkIds)));
    if (checks.length !== new Set(input.checkIds).size) throw new AppError("NOT_FOUND", "A check in the query does not belong to this shipment");
    if (checks.some((c) => c.status === "PASS" || c.status === "NOT_APPLICABLE")) throw new AppError("INVALID_STATE", "Only failed or incomplete checks can be queried");
    const next = transition(row.status, "raiseQuery", { actor: input.actor, derived: "NEEDS_REVIEW", unresolved: 0, submittedBy: row.submittedBy, discrepanciesAcknowledged: false });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);

    for (const c of checks) await resolve(tx, c.id, { resolution: "QUERY_RAISED", declaredValue: null, resolutionNote: input.message, resolvedBy: input.actor.id, resolvedAt: new Date() });
    await tx.update(shipments).set({ status: next.data }).where(eq(shipments.id, input.shipmentId));
    // Recipient is the importer's id only; no contact details in the log (PRD §12 privacy).
    await audit(tx, { actorId: input.actor.id, action: "IMPORTER_QUERY_SENT", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { recipientImporterId: row.importerId, checks: checks.length } });
    await audit(tx, { actorId: input.actor.id, action: "STATUS_CHANGED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { from: row.status, to: next.data } });
    const { version } = await recomputeShipment(tx, input.shipmentId, input.actor.id);
    return { shipmentVersion: version };
  });
}

/** The importer replied: open queries close and the status is derived from the data again. */
export async function resumeFromHold(input: { shipmentId: string; expectedVersion: number; note: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const row = await lockShipment(tx, input.shipmentId, input.expectedVersion);
    const snapshot = await loadSnapshot(tx, input.shipmentId);
    const next = transition(row.status, "resume", { actor: input.actor, derived: deriveReviewStatus(snapshot, 0), unresolved: 0, submittedBy: row.submittedBy, discrepanciesAcknowledged: false });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);

    await tx
      .update(crossCheckResults)
      .set({ resolution: null, declaredValue: null, resolutionNote: null, resolvedBy: null, resolvedAt: null, updatedAt: sql`now()` })
      .where(and(eq(crossCheckResults.shipmentId, input.shipmentId), eq(crossCheckResults.resolution, "QUERY_RAISED")));
    await audit(tx, { actorId: input.actor.id, action: "HOLD_CLEARED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { note: input.note } });
    const { status, version } = await recomputeShipment(tx, input.shipmentId, input.actor.id, { rederive: true });
    return { status, shipmentVersion: version };
  });
}
