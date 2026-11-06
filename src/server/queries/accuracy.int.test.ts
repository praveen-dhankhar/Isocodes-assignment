import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { extractedFields, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { seedScenarios } from "../db/seed-scenarios";
import { approveShipment } from "../services/approval";
import { extractDocument } from "../services/extraction";
import { setFieldValue, submitForApproval } from "../services/review";
import { createSampleShipment } from "../services/shipments";
import { getAccuracyReport } from "./accuracy";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const EXEC = { id: "exec-a", role: "DOCUMENTATION_EXECUTIVE" as const };
const MANAGER = { id: "manager-m", role: "DOCUMENTATION_MANAGER" as const };
const recorded = (sha: string) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha);
const version = async (id: string) => (await db().select({ v: shipments.version }).from(shipments).where(eq(shipments.id, id)))[0]?.v ?? 0;

beforeAll(async () => {
  await seed();
  await seedScenarios();
}, 120_000);

describe("getAccuracyReport (PRD §8.3)", () => {
  it("counts only corrections of AI-read values on approved/exported shipments, recorded samples when asked", async () => {
    expect((await getAccuracyReport({ includeSamples: false })).overall.total).toBe(0); // the seed is read from recorded samples
    const before = await getAccuracyReport({ includeSamples: true });

    // A clean shipment where someone corrects one value (as if the model misread it), then it is approved.
    const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: "SHP-24812", actorId: EXEC.id });
    for (const id of Object.values(documentIds)) if (id) await extractDocument({ shipmentId, documentId: id, force: false, discardHumanEdits: false, actorId: EXEC.id }, { providers: recorded });
    const [port] = await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentIds.BILL_OF_LADING ?? ""), eq(extractedFields.fieldKey, "portOfLoading"), isNull(extractedFields.lineItemId)));
    await setFieldValue({ fieldId: port?.id ?? "", expectedFieldVersion: port?.version ?? 1, input: "Goteborg", actorId: EXEC.id });
    await submitForApproval({ shipmentId, expectedVersion: await version(shipmentId), actor: EXEC });
    await approveShipment({ shipmentId, expectedVersion: await version(shipmentId), acknowledgedCheckIds: [], actor: MANAGER });

    const r = await getAccuracyReport({ includeSamples: true });
    expect(r.overall.corrected).toBe(before.overall.corrected + 1);
    expect(r.overall.total).toBeGreaterThan(before.overall.total);
    expect(r.byField.find((f) => f.key === "portOfLoading")?.corrected).toBeGreaterThanOrEqual(1);
    expect(r.bySupplier.map((s) => s.key)).toContain("Company C");
    expect(r.calibration.reduce((n, b) => n + b.total, 0)).toBe(r.overall.total);
    expect(r.log[0]).toMatchObject({ action: "CORRECT", where: "Bill of lading · Port of loading", to: "Goteborg" });
  });
});
