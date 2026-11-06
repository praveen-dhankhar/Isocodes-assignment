import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { runCrossChecks } from "@/domain/checks/run-checks";
import { computeBlockingIssues } from "@/domain/issues";
import { deriveReviewStatus, transition, type Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { db, type Tx } from "../db/client";
import { crossCheckResults, shipments } from "../db/schema";
import { audit } from "./audit";
import { lockShipment, recomputeShipment } from "./recompute";
import { loadSnapshot } from "./snapshot";

// API_SPECS §5.3 (manager). PRD §10.3 gate 2: no unresolved issues, approver ≠ submitter (A-14), and every accepted
// discrepancy acknowledged by the approver.

interface Actor {
  id: string;
  role: Role;
}

async function context(tx: Tx, shipmentId: string, actor: Actor, expectedVersion: number, allowExported = false) {
  const row = await lockShipment(tx, shipmentId, expectedVersion, { allowExported });
  const snapshot = await loadSnapshot(tx, shipmentId);
  const issues = computeBlockingIssues(snapshot, runCrossChecks(snapshot, CHECK_CONFIG));
  const ctx = { actor, derived: deriveReviewStatus(snapshot, issues.length), unresolved: issues.length, submittedBy: row.submittedBy };
  return { row, ctx };
}

const statusAudit = (tx: Tx, actorId: string, shipmentId: string, from: string, to: string) =>
  audit(tx, { actorId, action: "STATUS_CHANGED", entityType: "shipment", entityId: shipmentId, shipmentId, metadata: { from, to } });

export async function approveShipment(input: { shipmentId: string; expectedVersion: number; acknowledgedCheckIds: string[]; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { row, ctx } = await context(tx, input.shipmentId, input.actor, input.expectedVersion);
    const accepted = await tx
      .select({ id: crossCheckResults.id })
      .from(crossCheckResults)
      .where(and(eq(crossCheckResults.shipmentId, input.shipmentId), eq(crossCheckResults.resolution, "DISCREPANCY_ACCEPTED")));
    const ticked = new Set(input.acknowledgedCheckIds);
    const allTicked = accepted.length === ticked.size && accepted.every((c) => ticked.has(c.id));
    const next = transition(row.status, "approve", { ...ctx, discrepanciesAcknowledged: allTicked });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);

    if (accepted.length > 0) {
      await tx.update(crossCheckResults).set({ acknowledgedBy: input.actor.id }).where(inArray(crossCheckResults.id, accepted.map((c) => c.id)));
    }
    // approvedAt is this transaction's time; the data last changed in an earlier one, so the export gate passes.
    const [updated] = await tx
      .update(shipments)
      .set({ status: next.data, approvedBy: input.actor.id, approvedAt: sql`now()`, version: sql`${shipments.version} + 1`, updatedAt: sql`now()` })
      .where(eq(shipments.id, input.shipmentId))
      .returning({ version: shipments.version });
    await audit(tx, { actorId: input.actor.id, action: "APPROVED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { acknowledged: accepted.length } });
    await statusAudit(tx, input.actor.id, input.shipmentId, row.status, next.data);
    return { status: next.data, shipmentVersion: updated?.version ?? 0 };
  });
}

/** Back to the executive with a note; the status is derived from the data again. */
export async function sendBack(input: { shipmentId: string; expectedVersion: number; note: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { row, ctx } = await context(tx, input.shipmentId, input.actor, input.expectedVersion);
    const next = transition(row.status, "sendBack", { ...ctx, discrepanciesAcknowledged: false });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);
    await tx.update(shipments).set({ submittedBy: null, submittedAt: null }).where(eq(shipments.id, input.shipmentId));
    await audit(tx, { actorId: input.actor.id, action: "SENT_BACK", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { note: input.note } });
    const { status, version } = await recomputeShipment(tx, input.shipmentId, input.actor.id, { rederive: true });
    return { status, shipmentVersion: version };
  });
}

/** PRD F8: an APPROVED or EXPORTED shipment is opened for changes; it needs submit and approval again. Exports stay. */
export async function reopenShipment(input: { shipmentId: string; expectedVersion: number; reason: string; actor: Actor }) {
  return db().transaction(async (tx) => {
    const { row, ctx } = await context(tx, input.shipmentId, input.actor, input.expectedVersion, true);
    const next = transition(row.status, "reopen", { ...ctx, discrepanciesAcknowledged: false });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);
    await tx.update(shipments).set({ submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null }).where(eq(shipments.id, input.shipmentId));
    await tx.update(crossCheckResults).set({ acknowledgedBy: null }).where(eq(crossCheckResults.shipmentId, input.shipmentId));
    await audit(tx, { actorId: input.actor.id, action: "REOPENED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { from: row.status, reason: input.reason } });
    const { status, version } = await recomputeShipment(tx, input.shipmentId, input.actor.id, { rederive: true });
    return { status, shipmentVersion: version };
  });
}
