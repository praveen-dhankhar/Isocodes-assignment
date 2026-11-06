import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { runCrossChecks } from "@/domain/checks/run-checks";
import { buildExportRows, exportFileName, LAYOUT_VERSION, toCsv } from "@/domain/export/csv";
import { computeBlockingIssues } from "@/domain/issues";
import { canExport, transition, type ExportBlockReason, type Role } from "@/domain/status";
import { AppError } from "@/lib/errors";
import { db, type Db, type Tx } from "../db/client";
import { importers, shipmentExports, shipments, suppliers, user } from "../db/schema";
import { blobStore } from "../storage";
import { audit } from "./audit";
import { lockShipment } from "./recompute";
import { loadSnapshot } from "./snapshot";

// PRD §10.3 gate 3 and API_SPECS §4.6–4.7. The gate runs on the server inside the export transaction; the disabled
// button on S6 only mirrors it (CLAUDE.md rule 1).

async function build(q: Db | Tx, shipmentId: string, lock: boolean) {
  const snapshot = await loadSnapshot(q, shipmentId, { lock });
  const [m] = await q
    .select({ s: shipments, importer: importers, supplier: suppliers })
    .from(shipments)
    .innerJoin(importers, eq(importers.id, shipments.importerId))
    .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
    .where(eq(shipments.id, shipmentId));
  if (!m) throw new AppError("NOT_FOUND", "Shipment not found");
  const outcomes = runCrossChecks(snapshot, CHECK_CONFIG);
  const issues = computeBlockingIssues(snapshot, outcomes);
  const gate = canExport(snapshot, issues, { approvedAt: m.s.approvedAt, lastDataChangeAt: m.s.lastDataChangeAt });
  const rows = buildExportRows(snapshot, { importer: { name: m.importer.name, iec: m.importer.iec }, supplier: { name: m.supplier.name, countryCode: m.supplier.countryCode } }, outcomes);
  const invoiceNo = snapshot.documents.INVOICE?.header.invoiceNumber?.value ?? null;
  return { snapshot, shipment: m.s, issues, gate, rows, invoiceNo };
}

/** S6: the rows as they would be exported now, why export is blocked (if it is) and the earlier files. */
export async function previewExport(shipmentId: string) {
  const { shipment, gate, rows, issues } = await build(db(), shipmentId, false);
  const history = await db()
    .select({ id: shipmentExports.id, rowCount: shipmentExports.rowCount, layoutVersion: shipmentExports.layoutVersion, createdAt: shipmentExports.createdAt, by: user.name })
    .from(shipmentExports)
    .leftJoin(user, eq(user.id, shipmentExports.exportedBy))
    .where(eq(shipmentExports.shipmentId, shipmentId))
    .orderBy(desc(shipmentExports.createdAt));
  const reasons: ExportBlockReason[] = shipment.status === "EXPORTED" ? [] : gate.ok ? [] : gate.reasons;
  return {
    status: shipment.status,
    version: shipment.version,
    reasons,
    unresolved: issues.length,
    rows,
    history: history.map((h) => ({ ...h, by: h.by ?? "Someone", createdAt: h.createdAt.toISOString() })),
  };
}

/** POST /export: one transaction, shipment row locked; blocked → EXPORT_BLOCKED with the reasons. */
export async function exportShipment(input: { shipmentId: string; expectedVersion: number; actor: { id: string; role: Role } }) {
  return db().transaction(async (tx) => {
    await lockShipment(tx, input.shipmentId, input.expectedVersion); // EXPORTED → INVALID_STATE: reopen first
    const { shipment, gate, rows, invoiceNo, issues } = await build(tx, input.shipmentId, true);
    if (!gate.ok) throw new AppError("EXPORT_BLOCKED", "This shipment cannot be exported yet", { reasons: gate.reasons });
    const next = transition(shipment.status, "export", { actor: input.actor, derived: "EXTRACTED", unresolved: issues.length, submittedBy: shipment.submittedBy, discrepanciesAcknowledged: true });
    if (!next.ok) throw new AppError(next.error.code, next.error.message);

    const exportId = randomUUID();
    const bytes = new TextEncoder().encode(toCsv(rows));
    const storageKey = `shipments/${input.shipmentId}/exports/${exportId}.csv`;
    await blobStore().put(storageKey, bytes, "text/csv; charset=utf-8"); // a rollback after this leaves an orphan blob, never a row without a file
    await tx.insert(shipmentExports).values({
      id: exportId, shipmentId: input.shipmentId, layoutVersion: LAYOUT_VERSION, storageKey,
      fileSha256: createHash("sha256").update(bytes).digest("hex"), rowCount: rows.length - 1, exportedBy: input.actor.id,
    });
    const [updated] = await tx
      .update(shipments)
      .set({ status: next.data, version: sql`${shipments.version} + 1`, updatedAt: sql`now()` })
      .where(eq(shipments.id, input.shipmentId))
      .returning({ version: shipments.version });
    await audit(tx, { actorId: input.actor.id, action: "EXPORTED", entityType: "export", entityId: exportId, shipmentId: input.shipmentId, metadata: { rows: rows.length - 1, layout: LAYOUT_VERSION } });
    await audit(tx, { actorId: input.actor.id, action: "STATUS_CHANGED", entityType: "shipment", entityId: input.shipmentId, shipmentId: input.shipmentId, metadata: { from: shipment.status, to: next.data } });
    return { bytes, exportId, fileName: exportFileName(shipment.ref, invoiceNo, new Date()), shipmentVersion: updated?.version ?? 0 };
  });
}

/** GET /exports/:id: a stored file, exactly as it was exported. */
export async function downloadExport(input: { shipmentId: string; exportId: string; actorId: string }) {
  const [row] = await db()
    .select({ e: shipmentExports, ref: shipments.ref })
    .from(shipmentExports)
    .innerJoin(shipments, eq(shipments.id, shipmentExports.shipmentId))
    .where(and(eq(shipmentExports.id, input.exportId), eq(shipmentExports.shipmentId, input.shipmentId)));
  if (!row) throw new AppError("NOT_FOUND", "Export not found");
  const bytes = await blobStore().get(row.e.storageKey);
  const invoiceNo = (await loadSnapshot(db(), input.shipmentId, { lock: false })).documents.INVOICE?.header.invoiceNumber?.value ?? null;
  await db().transaction((tx) =>
    audit(tx, { actorId: input.actorId, action: "EXPORT_DOWNLOADED", entityType: "export", entityId: row.e.id, shipmentId: input.shipmentId, metadata: {} }),
  );
  return { bytes, fileName: exportFileName(row.ref, invoiceNo, row.e.createdAt) };
}
