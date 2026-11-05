import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CHECK_CONFIG } from "@/domain/checks/config";
import { runCrossChecks } from "@/domain/checks/run-checks";
import { shp24811, shp24813 } from "@/domain/checks/__fixtures__/snapshots";
import type { ShipmentSnapshot, ShipmentStatus } from "@/domain/snapshot";
import { AppError } from "@/lib/errors";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, documents, extractedFields, importers, lineItems, shipments, suppliers } from "../db/schema";
import { recomputeShipment } from "./recompute";
import { loadSnapshot } from "./snapshot";

/** Writes a domain fixture as the rows extraction will produce; returns the new shipment id. */
async function seed(snap: ShipmentSnapshot, status: ShipmentStatus = "DRAFT") {
  const uid = crypto.randomUUID().slice(0, 8);
  return db().transaction(async (tx) => {
    const [importer] = await tx.insert(importers).values({ name: `Importer ${uid}`, iec: "TESTIEC999" }).returning();
    const [supplier] = await tx.insert(suppliers).values({ name: `Supplier ${uid}`, countryCode: "CN", normalizedName: `supplier ${uid}` }).returning();
    const [shipment] = await tx
      .insert(shipments)
      .values({ ref: `${snap.ref}-${uid}`, importerId: importer!.id, supplierId: supplier!.id, status, createdBy: "int-test" })
      .returning();
    const shipmentId = shipment!.id;
    for (const [docType, d] of Object.entries(snap.documents)) {
      const [doc] = await tx
        .insert(documents)
        .values({
          shipmentId, docType: docType as keyof ShipmentSnapshot["documents"], status: d.status, storageKey: `test/${uid}/${docType}`,
          originalFilename: `${docType}.pdf`, mimeType: "application/pdf", sizeBytes: 1, sha256: "0".repeat(64),
          pageCount: 1, hasTextLayer: true, detectedDocType: d.detectedDocType, uploadedBy: "int-test",
        })
        .returning();
      const field = (lineItemId: string | null) => ([fieldKey, f]: [string, { value: string | null; status: "UNREVIEWED" | "CONFIRMED" | "CORRECTED" | "MANUAL"; confidence: number | null }]) => ({
        shipmentId, documentId: doc!.id, lineItemId, fieldKey, value: f.value, originalAiValue: f.value, status: f.status,
        confidence: f.confidence === null ? null : String(f.confidence),
      });
      await tx.insert(extractedFields).values(Object.entries(d.header).map(field(null)));
      for (const line of d.lines) {
        const [item] = await tx.insert(lineItems).values({ documentId: doc!.id, lineNo: line.lineNo }).returning();
        await tx.insert(extractedFields).values(Object.entries(line.cells).map(field(item!.id)));
      }
    }
    return shipmentId;
  });
}

const recompute = (id: string) => db().transaction((tx) => recomputeShipment(tx, id, "int-test"));
const shipmentRow = async (id: string) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0]!;
const checkRow = async (id: string, ruleId: string, scope = "shipment") =>
  (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, id), eq(crossCheckResults.ruleId, ruleId), eq(crossCheckResults.scope, scope))))[0];
const actions = async (id: string) => (await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, id))).map((a) => a.action);
const setPackingListGross = async (id: string, value: string) => {
  const [pl] = await db().select().from(documents).where(and(eq(documents.shipmentId, id), eq(documents.docType, "PACKING_LIST")));
  await db().update(extractedFields).set({ value }).where(and(eq(extractedFields.documentId, pl!.id), eq(extractedFields.fieldKey, "grossWeight")));
};

describe("recomputeShipment (ARCHITECTURE §7.5)", () => {
  it("SHP-24811: NEEDS_REVIEW with one failed check", async () => {
    const id = await seed(shp24811());
    const result = await recompute(id);

    expect(result).toMatchObject({ status: "NEEDS_REVIEW", unresolvedIssuesCount: 1, version: 2 });
    expect(await shipmentRow(id)).toMatchObject({ status: "NEEDS_REVIEW", failedCheckCount: 1, unresolvedIssuesCount: 1, version: 2 });
    expect(await checkRow(id, "CC-03")).toMatchObject({ status: "FAIL", severity: "CRITICAL", delta: "45.000", engineVersion: "ce-1.0.0" });
    expect(await actions(id)).toEqual(["STATUS_CHANGED"]);
  });

  it("loads back the snapshot the fixture describes", async () => {
    const id = await seed(shp24811());
    const loaded = await db().transaction((tx) => loadSnapshot(tx, id));
    const summary = (s: ShipmentSnapshot) => runCrossChecks(s, CHECK_CONFIG).map((o) => [o.ruleId, o.scope, o.status, o.delta, o.fingerprint]);
    expect(summary(loaded)).toEqual(summary(shp24811()));
  });

  it("keeps an accepted discrepancy, then re-opens it when the packing-list weight changes", async () => {
    const id = await seed(shp24811());
    await recompute(id);
    const cc03 = (await checkRow(id, "CC-03"))!;
    await db().update(crossCheckResults).set({ resolution: "DISCREPANCY_ACCEPTED", declaredValue: "3165.000", resolutionNote: "Supplier confirmed PL", resolvedBy: "int-test" }).where(eq(crossCheckResults.id, cc03.id));

    expect((await recompute(id)).status).toBe("EXTRACTED");
    expect((await checkRow(id, "CC-03"))?.resolution).toBe("DISCREPANCY_ACCEPTED");

    await setPackingListGross(id, "3150.000");
    expect((await recompute(id)).status).toBe("NEEDS_REVIEW");
    expect(await checkRow(id, "CC-03")).toMatchObject({ resolution: null, declaredValue: null, resolvedBy: null, delta: "45.000" });
    expect(await actions(id)).toContain("CHECK_REOPENED");
  });

  it("invalidates an approval when data changes", async () => {
    const id = await seed(shp24813(), "APPROVED");
    await db().update(shipments).set({ approvedBy: "manager", approvedAt: new Date() }).where(eq(shipments.id, id));
    await recompute(id);
    expect(await shipmentRow(id)).toMatchObject({ status: "EXTRACTED", approvedBy: null, approvedAt: null });
    expect(await actions(id)).toEqual(expect.arrayContaining(["STATUS_CHANGED", "APPROVAL_INVALIDATED"]));
  });

  it("keeps an exported shipment read-only", async () => {
    const id = await seed(shp24813(), "EXPORTED");
    const outcome = await recompute(id).then(() => "recomputed", (e: unknown) => (e instanceof AppError ? e.code : String(e)));
    expect(outcome).toBe("INVALID_STATE");
    expect(await shipmentRow(id)).toMatchObject({ status: "EXPORTED", version: 1 });
  });

  it("drops results a rule no longer emits", async () => {
    const id = await seed(shp24813());
    await recompute(id);
    expect(await checkRow(id, "CC-01", "line:2")).toBeDefined();

    const [inv] = await db().select().from(documents).where(and(eq(documents.shipmentId, id), eq(documents.docType, "INVOICE")));
    await db().delete(lineItems).where(and(eq(lineItems.documentId, inv!.id), eq(lineItems.lineNo, 2)));
    await recompute(id);
    expect(await checkRow(id, "CC-01", "line:2")).toBeUndefined();
  });
});
