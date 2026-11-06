import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, extractedFields, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { extractDocument } from "./extraction";
import { acceptDiscrepancy, acknowledgeMissing, clearResolution, raiseImporterQuery, resumeFromHold } from "./resolutions";
import { confirmField, setFieldValue } from "./review";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const ACTOR = { id: "int-test", role: "DOCUMENTATION_EXECUTIVE" as const };
const recorded = (sha: string) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const NOTE = "Carrier re-weighed at port; B/L figure is the one to file.";

beforeAll(async () => {
  await seed();
});

async function sample(ref: string) {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: ref, actorId: ACTOR.id });
  for (const id of Object.values(documentIds)) if (id) await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: ACTOR.id }, { providers: recorded });
  return { shipmentId, ids: documentIds };
}
const ship = async (id: string) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0];
const version = async (id: string) => (await ship(id))?.version ?? 0;
const check = async (shipmentId: string, ruleId: string) => (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, ruleId))))[0];
const field = async (documentId: string, key: string) =>
  (await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.fieldKey, key), isNull(extractedFields.lineItemId))))[0];

describe("resolutions (API_SPECS §5.2)", () => {
  it("an accepted discrepancy survives recompute, and re-opens when an observed value changes", async () => {
    const { shipmentId, ids } = await sample("SHP-24811");
    const cc03 = await check(shipmentId, "CC-03");
    const before = (await ship(shipmentId))?.unresolvedIssuesCount ?? 0;
    const { check: dto } = await acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "3,165 kg", note: NOTE, actor: ACTOR });
    expect(dto).toMatchObject({ resolution: "DISCREPANCY_ACCEPTED", declaredValue: "3165.000", status: "FAIL" });
    expect((await ship(shipmentId))?.unresolvedIssuesCount).toBe(before - 1);

    // An unrelated edit recomputes; the resolution stays.
    const total = await field(ids.INVOICE ?? "", "invoiceTotal");
    await confirmField({ fieldId: total?.id ?? "", expectedFieldVersion: total?.version ?? 1, actorId: ACTOR.id });
    expect((await check(shipmentId, "CC-03"))?.resolution).toBe("DISCREPANCY_ACCEPTED");

    // A changed gross weight changes the fingerprint: the check re-opens.
    const gross = await field(ids.PACKING_LIST ?? "", "grossWeight");
    await setFieldValue({ fieldId: gross?.id ?? "", expectedFieldVersion: gross?.version ?? 1, input: "3,170 KGS", actorId: ACTOR.id });
    expect(await check(shipmentId, "CC-03")).toMatchObject({ status: "FAIL", resolution: null, declaredValue: null });
    expect((await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action)).toContain("CHECK_REOPENED");
  });

  it("only FAIL checks can be accepted; the declared value must read as the check's kind; undo re-opens", async () => {
    const { shipmentId } = await sample("SHP-24811");
    const cc02 = await check(shipmentId, "CC-02");
    expect(await code(acceptDiscrepancy({ checkId: cc02?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "1", note: NOTE, actor: ACTOR }))).toBe("INVALID_STATE");
    const cc03 = await check(shipmentId, "CC-03");
    expect(await code(acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "3.165,0O", note: NOTE, actor: ACTOR }))).toBe("VALIDATION_FAILED");
    expect(await code(acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: (await version(shipmentId)) - 1, declaredValue: "3165", note: NOTE, actor: ACTOR }))).toBe("VERSION_CONFLICT");

    await acceptDiscrepancy({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), declaredValue: "3165", note: NOTE, actor: ACTOR });
    await clearResolution({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), actor: ACTOR });
    expect((await check(shipmentId, "CC-03"))?.resolution).toBeNull();
    expect(await code(acknowledgeMissing({ checkId: cc03?.id ?? "", expectedVersion: await version(shipmentId), note: NOTE, actor: ACTOR }))).toBe("INVALID_STATE");
  });

  it("query importer puts the shipment ON_HOLD; resume closes the query and re-derives the status", async () => {
    const { shipmentId } = await sample("SHP-24814");
    const cc06 = (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, "CC-06"), eq(crossCheckResults.status, "FAIL"))))[0];
    await raiseImporterQuery({ shipmentId, expectedVersion: await version(shipmentId), checkIds: [cc06?.id ?? ""], message: "Please confirm the USB-C quantity shipped.", actor: ACTOR });
    expect((await ship(shipmentId))?.status).toBe("ON_HOLD");
    expect((await db().select().from(crossCheckResults).where(eq(crossCheckResults.id, cc06?.id ?? "")))[0]?.resolution).toBe("QUERY_RAISED");
    const sent = (await db().select().from(auditLogs).where(and(eq(auditLogs.shipmentId, shipmentId), eq(auditLogs.action, "IMPORTER_QUERY_SENT"))))[0];
    expect(Object.keys(sent?.metadata as object).sort()).toEqual(["checks", "recipientImporterId"]);

    const resumed = await resumeFromHold({ shipmentId, expectedVersion: await version(shipmentId), note: "Importer confirmed 10,000 pieces.", actor: ACTOR });
    expect(resumed.status).toBe("NEEDS_REVIEW");
    expect((await db().select().from(crossCheckResults).where(eq(crossCheckResults.id, cc06?.id ?? "")))[0]?.resolution).toBeNull();
    expect(await code(resumeFromHold({ shipmentId, expectedVersion: await version(shipmentId), note: "again", actor: ACTOR }))).toBe("INVALID_STATE");
  });
});
