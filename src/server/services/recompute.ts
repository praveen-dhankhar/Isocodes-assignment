import "server-only";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { ENGINE_VERSION, runCrossChecks } from "@/domain/checks/run-checks";
import { computeBlockingIssues } from "@/domain/issues";
import { deriveReviewStatus, nextStatusAfterDataChange } from "@/domain/status";
import { AppError } from "@/lib/errors";
import type { Tx } from "../db/client";
import { crossCheckResults, shipments } from "../db/schema";
import { shipmentStatus } from "../queries/shipments";
import { audit } from "./audit";
import { loadSnapshot } from "./snapshot";

const fromExcluded = (column: string) => sql.raw(`excluded."${column}"`);

/**
 * Start of every mutation: lock the shipment row, refuse an exported shipment (read-only until reopened) and, when
 * the caller sent one, check optimistic concurrency (API_SPECS §1: stale → 409 VERSION_CONFLICT with the current state).
 */
export async function lockShipment(tx: Tx, shipmentId: string, expectedVersion?: number) {
  const [row] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
  if (!row) throw new AppError("NOT_FOUND", "Shipment not found");
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw new AppError("VERSION_CONFLICT", "Someone else changed this shipment; reload to see the latest", { current: await shipmentStatus(tx, shipmentId) });
  }
  if (row.status === "EXPORTED") throw new AppError("INVALID_STATE", "Exported shipments are read-only until a manager reopens them");
  return row;
}

/**
 * ARCHITECTURE §7.5, invariant 4: every write that can change checks calls this in the same transaction, before
 * commit. Results, issue counts, status and version move together. An exported shipment is refused (read-only
 * until reopened), which rolls the caller's transaction back.
 */
export async function recomputeShipment(tx: Tx, shipmentId: string, actorId: string | null) {
  const snap = await loadSnapshot(tx, shipmentId);
  const outcomes = runCrossChecks(snap, CHECK_CONFIG);

  const issues = computeBlockingIssues(snap, outcomes);
  const next = nextStatusAfterDataChange(snap.status, deriveReviewStatus(snap, issues.length));
  if (!next.ok) throw new AppError(next.error.code, next.error.message);

  // Upsert every result; a stored resolution is left alone here and cleared below only if it did not carry over.
  const written =
    outcomes.length === 0
      ? []
      : await tx
          .insert(crossCheckResults)
          .values(outcomes.map((o) => ({
            shipmentId, ruleId: o.ruleId, scope: o.scope, status: o.status, severity: o.severity, observed: o.observed,
            delta: o.delta, message: o.message, notes: o.notes, fingerprint: o.fingerprint, engineVersion: ENGINE_VERSION,
          })))
          .onConflictDoUpdate({
            target: [crossCheckResults.shipmentId, crossCheckResults.ruleId, crossCheckResults.scope],
            set: {
              status: fromExcluded("status"), severity: fromExcluded("severity"), observed: fromExcluded("observed"),
              delta: fromExcluded("delta"), message: fromExcluded("message"), notes: fromExcluded("notes"),
              fingerprint: fromExcluded("fingerprint"), engineVersion: fromExcluded("engine_version"), updatedAt: sql`now()`,
            },
          })
          .returning({ id: crossCheckResults.id, ruleId: crossCheckResults.ruleId, scope: crossCheckResults.scope });

  await tx
    .delete(crossCheckResults)
    .where(and(eq(crossCheckResults.shipmentId, shipmentId), written.length > 0 ? notInArray(crossCheckResults.id, written.map((w) => w.id)) : undefined));

  // A resolution whose fingerprint changed no longer applies: the check re-opens (PRD §9 resolution memory).
  for (const o of outcomes.filter((o) => o.resolution === null && snap.priorResolutions[o.ruleId]?.[o.scope])) {
    const row = written.find((w) => w.ruleId === o.ruleId && w.scope === o.scope);
    if (!row) continue;
    await tx
      .update(crossCheckResults)
      .set({ resolution: null, declaredValue: null, resolutionNote: null, resolvedBy: null, resolvedAt: null, acknowledgedBy: null })
      .where(eq(crossCheckResults.id, row.id));
    await audit(tx, { actorId, action: "CHECK_REOPENED", entityType: "cross_check_result", entityId: row.id, shipmentId, metadata: { ruleId: o.ruleId, scope: o.scope } });
  }

  const { status, approvalInvalidated } = next.data;
  const [updated] = await tx
    .update(shipments)
    .set({
      status,
      unresolvedIssuesCount: issues.length,
      failedCheckCount: outcomes.filter((o) => o.status === "FAIL").length, // mismatches, accepted or not (S2)
      lastDataChangeAt: sql`now()`,
      updatedAt: sql`now()`,
      version: sql`${shipments.version} + 1`,
      ...(approvalInvalidated ? { approvedBy: null, approvedAt: null } : {}),
    })
    .where(eq(shipments.id, shipmentId))
    .returning({ version: shipments.version });

  if (status !== snap.status) {
    await audit(tx, { actorId, action: "STATUS_CHANGED", entityType: "shipment", entityId: shipmentId, shipmentId, metadata: { from: snap.status, to: status } });
  }
  if (approvalInvalidated) {
    await audit(tx, { actorId, action: "APPROVAL_INVALIDATED", entityType: "shipment", entityId: shipmentId, shipmentId, metadata: { from: snap.status } });
  }

  return { status, version: updated?.version ?? 0, unresolvedIssuesCount: issues.length, issues, outcomes };
}
