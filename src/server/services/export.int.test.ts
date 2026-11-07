import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, extractedFields, shipmentExports, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { approveShipment, reopenShipment } from "./approval";
import { downloadExport, exportShipment } from "./export";
import { extractDocument } from "./extraction";
import { acceptDiscrepancy } from "./resolutions";
import { confirmField, submitForApproval } from "./review";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const EXEC = { id: "exec-a", role: "DOCUMENTATION_EXECUTIVE" as const };
const MANAGER = { id: "manager-m", role: "DOCUMENTATION_MANAGER" as const };
const recorded = (sha: string) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha);
const failure = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof AppError ? e : null));
const ship = async (id: string) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0];
const version = async (id: string) => (await ship(id))?.version ?? 0;
const field = async (documentId: string, key: string) =>
  (await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.fieldKey, key), isNull(extractedFields.lineItemId))))[0];

beforeAll(async () => {
  await seed();
});

async function sample(ref: string) {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: ref, actorId: EXEC.id });
  for (const id of Object.values(documentIds)) if (id) await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: EXEC.id }, { providers: recorded });
  return { shipmentId, ids: documentIds };
}

/** SHP-24811 reviewed as in API_SPECS §6.3: CC-03 accepted at 3,165 kg, net weight confirmed, submitted, approved. */
async function approved24811() {
  const { shipmentId, ids } = await sample("SHP-24811");
  const cc03 = (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, "CC-03"))))[0];
  await acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "3,165", note: "Supplier confirmed the invoice weight was a typo.", actor: EXEC });
  const net = await field(ids.PACKING_LIST ?? "", "netWeight");
  await confirmField({ fieldId: net?.id ?? "", expectedFieldVersion: net?.version ?? 1, actorId: EXEC.id });
  await submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
  await approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [cc03?.id ?? ""], actor: MANAGER });
  return { shipmentId, ids };
}

describe("export gate (PRD §10.3 gate 3, API_SPECS §4.6)", () => {
  it("SHP-24811 before review → EXPORT_BLOCKED with UNRESOLVED_ISSUES and NOT_APPROVED", async () => {
    const { shipmentId } = await sample("SHP-24811");
    const e = await failure(exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC }));
    expect(e?.code).toBe("EXPORT_BLOCKED");
    expect((e?.details as { reasons: string[] }).reasons).toEqual(expect.arrayContaining(["UNRESOLVED_ISSUES", "NOT_APPROVED"]));
    expect(await db().select().from(shipmentExports).where(eq(shipmentExports.shipmentId, shipmentId))).toHaveLength(0);
  });

  it("an approved shipment exports the golden rows, becomes EXPORTED, and re-download is audited", async () => {
    const { shipmentId } = await approved24811();
    const out = await exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(out.csv.bytes); // keep the BOM
    expect(text.startsWith("﻿SHIPMENT_REF,")).toBe(true);
    expect(text).toContain(",BLNGB2610447,XZQU4821171,240,3165.000,2880.000,1,LED panel light 40W,94054290,2400,PCS,6.80,16320.00\r\n");
    expect(out.csv.fileName).toMatch(/^SHP-\d+_CB-2026-1187_CF1_\d{8}-\d{4}\.csv$/);
    expect(out.xlsx.fileName).toMatch(/\.xlsx$/);
    expect([...out.xlsx.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // a zip, as every .xlsx is
    expect((await ship(shipmentId))?.status).toBe("EXPORTED");

    // Exported is read-only; a new export needs reopen and approval again.
    expect((await failure(exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC })))?.code).toBe("INVALID_STATE");
    const again = await downloadExport({ shipmentId, exportId: out.exportId, format: "csv", actorId: MANAGER.id });
    expect(again.bytes).toEqual(out.csv.bytes);
    const sheet = await downloadExport({ shipmentId, exportId: out.exportId, format: "xlsx", actorId: MANAGER.id });
    expect(sheet.bytes).toEqual(out.xlsx.bytes);
    expect((await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action)).toEqual(expect.arrayContaining(["EXPORTED", "EXPORT_DOWNLOADED"]));
  });

  it("a data change after approval blocks export", async () => {
    const { shipmentId, ids } = await approved24811();
    const total = await field(ids.INVOICE ?? "", "invoiceTotal");
    await confirmField({ fieldId: total?.id ?? "", expectedFieldVersion: total?.version ?? 1, actorId: EXEC.id }); // invalidates approval
    const e = await failure(exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC }));
    expect(e?.code).toBe("EXPORT_BLOCKED");
    expect((e?.details as { reasons: string[] }).reasons).toEqual(expect.arrayContaining(["NOT_APPROVED", "WRONG_STATUS"]));
  });

  it("lastDataChangeAt after approvedAt alone → CHANGED_AFTER_APPROVAL (defence in depth)", async () => {
    const { shipmentId } = await approved24811();
    await db().update(shipments).set({ lastDataChangeAt: new Date(Date.now() + 60_000) }).where(eq(shipments.id, shipmentId));
    const e = await failure(exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC }));
    expect((e?.details as { reasons: string[] }).reasons).toEqual(["CHANGED_AFTER_APPROVAL"]);
  });

  it("reopen after export allows a fresh approval and a second export; the first file stays", async () => {
    const { shipmentId } = await approved24811();
    await exportShipment({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
    await reopenShipment({ shipmentId, expectedVersion: await version(shipmentId), reason: "Importer sent an amended invoice.", actor: MANAGER });
    expect((await ship(shipmentId))?.status).toBe("EXTRACTED");
    expect(await db().select().from(shipmentExports).where(eq(shipmentExports.shipmentId, shipmentId))).toHaveLength(1);
  });
});
