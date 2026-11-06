import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, documents, extractedFields, fieldEdits, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { extractDocument } from "./extraction";
import { markPageUnreadable } from "./manual-entry";
import { confirmField, setFieldValue, submitForApproval } from "./review";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const ACTOR = "int-test";
const EXEC = { id: ACTOR, role: "DOCUMENTATION_EXECUTIVE" as const };
const recorded = (sha: string) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));

beforeAll(async () => {
  await seed();
});

async function sample(ref: string) {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: ref, actorId: ACTOR });
  for (const id of Object.values(documentIds)) if (id) await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: ACTOR }, { providers: recorded });
  return { shipmentId, ids: documentIds };
}
const field = async (documentId: string, key: string) =>
  (await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.fieldKey, key), isNull(extractedFields.lineItemId))))[0];
const shipment = async (id: string) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0];
const check = async (shipmentId: string, ruleId: string) => (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, ruleId))))[0];

describe("review service (API_SPECS §5.2)", () => {
  it("confirm on a stale field version → VERSION_CONFLICT with the current field", async () => {
    const { ids } = await sample("SHP-24811");
    const f = await field(ids.INVOICE ?? "", "invoiceTotal");
    const stale = await confirmField({ fieldId: f?.id ?? "", expectedFieldVersion: (f?.version ?? 1) - 1, actorId: ACTOR }).catch((e: unknown) => e);
    expect(stale instanceof AppError && stale.code).toBe("VERSION_CONFLICT");
    expect(stale instanceof AppError && (stale.details as { current: { id: string } }).current.id).toBe(f?.id);

    const ok = await confirmField({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, actorId: ACTOR });
    expect(ok.field).toMatchObject({ status: "CONFIRMED", isConfirmedByHuman: true, version: (f?.version ?? 1) + 1 });
    expect((await db().select().from(fieldEdits).where(eq(fieldEdits.fieldId, f?.id ?? ""))).map((e) => e.action)).toEqual(["CONFIRM"]);
  });

  it("correcting a misread invoice gross weight turns CC-03 PASS and records CORRECT", async () => {
    const { shipmentId, ids } = await sample("SHP-24811");
    expect((await check(shipmentId, "CC-03"))?.status).toBe("FAIL");
    const f = await field(ids.INVOICE ?? "", "grossWeight");
    const { field: dto, shipmentVersion } = await setFieldValue({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, input: "3,165.00 KGS", actorId: ACTOR });
    expect(dto).toMatchObject({ value: "3165.000", status: "CORRECTED", originalAiValue: "3120.000", display: "3,165.000" });
    expect((await check(shipmentId, "CC-03"))?.status).toBe("PASS");
    expect((await shipment(shipmentId))?.version).toBe(shipmentVersion);
    expect((await db().select().from(fieldEdits).where(eq(fieldEdits.fieldId, f?.id ?? ""))).map((e) => [e.action, e.previousValue, e.newValue])).toEqual([["CORRECT", "3120.000", "3165.000"]]);
  });

  it("refuses a value it cannot read, with a human message", async () => {
    const { ids } = await sample("SHP-24811");
    const f = await field(ids.INVOICE ?? "", "grossWeight");
    const e = await setFieldValue({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, input: "3.120,0O", actorId: ACTOR }).catch((x: unknown) => x);
    expect(e instanceof AppError && [e.code, e.message]).toEqual(["VALIDATION_FAILED", "Couldn't read '3.120,0O' as a weight"]);
  });

  it("typing exactly what the AI read is a confirmation; a field from an unreadable page is a manual entry", async () => {
    const { shipmentId, ids } = await sample("SHP-24811");
    const total = await field(ids.INVOICE ?? "", "invoiceTotal");
    expect((await setFieldValue({ fieldId: total?.id ?? "", expectedFieldVersion: total?.version ?? 1, input: "16,320.00", actorId: ACTOR })).field.status).toBe("CONFIRMED");

    await markPageUnreadable({ documentId: ids.PACKING_LIST ?? "", pageNo: 1, expectedVersion: (await shipment(shipmentId))?.version ?? 0, actorId: ACTOR });
    const net = await field(ids.PACKING_LIST ?? "", "netWeight");
    const { field: dto } = await setFieldValue({ fieldId: net?.id ?? "", expectedFieldVersion: net?.version ?? 1, input: "2880", actorId: ACTOR });
    expect(dto).toMatchObject({ status: "MANUAL", value: "2880.000" });
    expect((await db().select().from(fieldEdits).where(eq(fieldEdits.fieldId, net?.id ?? "")))[0]?.action).toBe("MANUAL_ENTRY");
  });

  it("submit needs zero issues; an edit while READY_FOR_APPROVAL re-derives the status and logs APPROVAL_INVALIDATED", async () => {
    const blocked = await sample("SHP-24811");
    expect(await code(submitForApproval({ shipmentId: blocked.shipmentId, expectedVersion: (await shipment(blocked.shipmentId))?.version ?? 0, actor: EXEC }))).toBe("INVALID_STATE");

    const { shipmentId, ids } = await sample("SHP-24812");
    expect((await shipment(shipmentId))?.status).toBe("EXTRACTED");
    const submitted = await submitForApproval({ shipmentId, expectedVersion: (await shipment(shipmentId))?.version ?? 0, actor: EXEC });
    expect(submitted.status).toBe("READY_FOR_APPROVAL");
    expect((await shipment(shipmentId))?.submittedBy).toBe(ACTOR);

    const f = await field(ids.INVOICE ?? "", "invoiceNumber");
    await confirmField({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, actorId: ACTOR });
    expect((await shipment(shipmentId))?.status).toBe("EXTRACTED");
    expect((await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action)).toContain("APPROVAL_INVALIDATED");
  });

  it("edits on an exported shipment → INVALID_STATE", async () => {
    const { shipmentId, ids } = await sample("SHP-24812");
    await db().update(shipments).set({ status: "EXPORTED" }).where(eq(shipments.id, shipmentId));
    const f = await field(ids.INVOICE ?? "", "invoiceTotal");
    expect(await code(confirmField({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, actorId: ACTOR }))).toBe("INVALID_STATE");
    expect(await code(setFieldValue({ fieldId: f?.id ?? "", expectedFieldVersion: f?.version ?? 1, input: "1", actorId: ACTOR }))).toBe("INVALID_STATE");
    expect((await db().select().from(documents).where(eq(documents.shipmentId, shipmentId))).length).toBe(3);
  });
});
