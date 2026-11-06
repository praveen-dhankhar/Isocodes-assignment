import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders, type ExtractionProvider } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, crossCheckResults, documentPages, documents, extractedFields, fieldEdits, lineItems, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { extractDocument, type ExtractDeps } from "./extraction";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const ACTOR = "int-test";

const SAMPLE_ONLY: ExtractDeps = {
  providers: (sha) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha),
};
const failing = (code: "AI_RATE_LIMITED" | "AI_TIMEOUT"): ExtractDeps => ({
  providers: () => [{ mode: "LIVE", modelId: "test-model", extractPage: async () => ({ ok: false, error: { code, retryable: true, message: code } }) } satisfies ExtractionProvider],
});
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));

beforeAll(async () => {
  await seed();
});

async function sampleShipment(ref: string) {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: ref, actorId: ACTOR });
  return { shipmentId, ids: documentIds };
}
const extract = (shipmentId: string, documentId: string, deps: ExtractDeps = SAMPLE_ONLY, opts: { force?: boolean; discardHumanEdits?: boolean } = {}) =>
  extractDocument({ shipmentId, documentId, force: opts.force ?? false, discardHumanEdits: opts.discardHumanEdits ?? false, actorId: ACTOR }, deps);
async function extractAll(shipmentId: string, ids: Partial<Record<string, string>>) {
  for (const id of Object.values(ids)) if (id) await extract(shipmentId, id);
}
const field = async (documentId: string, key: string) =>
  (await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.fieldKey, key), isNull(extractedFields.lineItemId))))[0];
const check = async (shipmentId: string, ruleId: string) =>
  (await db().select().from(crossCheckResults).where(and(eq(crossCheckResults.shipmentId, shipmentId), eq(crossCheckResults.ruleId, ruleId))))[0];

describe("extractDocument (ARCHITECTURE §7.2)", () => {
  it("SHP-24811 from recorded samples: CC-03 FAIL Δ 45 kg, labelled SAMPLE, evidence from the PDF text layer", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24811");
    const first = await extract(shipmentId, ids.INVOICE ?? "");
    expect(first.document).toMatchObject({ status: "EXTRACTED", mode: "SAMPLE", modelId: "hand-authored", detectedDocType: "COMMERCIAL_INVOICE" });
    await extract(shipmentId, ids.PACKING_LIST ?? "");
    const last = await extract(shipmentId, ids.BILL_OF_LADING ?? "");

    expect(last.shipment).toMatchObject({ status: "NEEDS_REVIEW", failedCheckCount: 1 });
    expect(await check(shipmentId, "CC-03")).toMatchObject({ status: "FAIL", delta: "45.000" });
    expect(await check(shipmentId, "CC-02")).toMatchObject({ status: "PASS" });

    const gross = await field(ids.INVOICE ?? "", "grossWeight");
    expect(gross).toMatchObject({ rawText: "3,120.00 KGS", value: "3120.000", originalAiValue: "3120.000", pageNo: 1, status: "UNREVIEWED" });
    expect(gross?.confidenceSignals).toMatchObject({ evidence: "FOUND", caps: [] });
    const lines = await db().select().from(lineItems).where(eq(lineItems.documentId, ids.INVOICE ?? ""));
    expect(lines.map((l) => l.lineNo)).toEqual([1]);
    const actions = (await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action);
    expect(actions.filter((a) => a === "EXTRACTION_SUCCEEDED")).toHaveLength(3);
  });

  it("SHP-24815's scanned B/L: no text layer cap, low-confidence container, CC-07 FAIL", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24815");
    await extractAll(shipmentId, ids);
    const container = await field(ids.BILL_OF_LADING ?? "", "containerNumbers");
    expect(container).toMatchObject({ value: "XZQU4821254", confidence: "0.400" }); // model 0.62, then check digit wrong → 0.40
    expect((container?.confidenceSignals as { caps: Array<{ reason: string }> }).caps.map((c) => c.reason)).toEqual(["FORMAT_INVALID", "NO_TEXT_LAYER"]);
    expect(await check(shipmentId, "CC-07")).toMatchObject({ status: "FAIL" });
  });

  it("SHP-24818's unreadable packing-list page: page marked, its required fields left for manual entry", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24818");
    const { document } = await extract(shipmentId, ids.PACKING_LIST ?? "");
    expect(document.status).toBe("EXTRACTED");
    const pages = await db().select().from(documentPages).where(eq(documentPages.documentId, document.id));
    expect(pages.map((p) => [p.pageNo, p.readable, p.issues]).sort()).toEqual([[1, true, []], [2, false, ["BLURRY"]]]);
    expect(await field(document.id, "grossWeight")).toMatchObject({ value: null, confidence: "0.000", pageNo: 2 });
  });

  it("a provider error leaves the document FAILED with the code (still a 200 outcome)", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24819");
    const { document, shipment } = await extract(shipmentId, ids.INVOICE ?? "", failing("AI_RATE_LIMITED"));
    expect(document).toMatchObject({ status: "FAILED", errorCode: "AI_RATE_LIMITED" });
    expect(shipment.status).toBe("DRAFT");
    expect((await db().select().from(auditLogs).where(eq(auditLogs.entityId, document.id))).map((a) => a.action)).toContain("EXTRACTION_FAILED");
    // FAILED is claimable again (Retry).
    expect((await extract(shipmentId, document.id)).document.status).toBe("EXTRACTED");
  });

  it("no live model and no recorded sample → FAILED with AI_NOT_CONFIGURED (nothing invented)", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24819");
    const { document } = await extract(shipmentId, ids.INVOICE ?? "", { providers: () => [] });
    expect(document).toMatchObject({ status: "FAILED", errorCode: "AI_NOT_CONFIGURED" });
    expect(await db().select().from(extractedFields).where(eq(extractedFields.documentId, document.id))).toHaveLength(0);
  });

  it("does not re-extract an extracted document unless forced, and refuses to discard human edits", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24819");
    const docId = ids.INVOICE ?? "";
    await extract(shipmentId, docId);
    expect(await code(extract(shipmentId, docId))).toBe("INVALID_STATE");

    const total = await field(docId, "invoiceTotal");
    await db().update(extractedFields).set({ status: "CONFIRMED" }).where(eq(extractedFields.id, total?.id ?? ""));
    await db().insert(fieldEdits).values({ fieldId: total?.id ?? "", shipmentId, supplierId: (await db().select().from(shipments).where(eq(shipments.id, shipmentId)))[0]?.supplierId ?? "", docType: "INVOICE", fieldKey: "invoiceTotal", action: "CONFIRM", previousValue: "4260.00", newValue: "4260.00", originalAiValue: "4260.00", userId: ACTOR });

    expect(await code(extract(shipmentId, docId, SAMPLE_ONLY, { force: true }))).toBe("HUMAN_EDITS_EXIST");
    const redone = await extract(shipmentId, docId, SAMPLE_ONLY, { force: true, discardHumanEdits: true });
    expect(redone.document.status).toBe("EXTRACTED");
    expect((await field(docId, "invoiceTotal"))?.status).toBe("UNREVIEWED");
    const history = await db().select().from(fieldEdits).where(eq(fieldEdits.shipmentId, shipmentId));
    expect(history).toHaveLength(1); // the edit survives, detached from the replaced field
    expect(history[0]?.fieldId).toBeNull();
  });

  it("reclaims a document stuck in EXTRACTING for over 5 minutes, but not a fresh one", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24819");
    const docId = ids.INVOICE ?? "";
    const stuck = (minutes: number) =>
      db().update(documents).set({ status: "EXTRACTING", extractionStartedAt: new Date(Date.now() - minutes * 60_000) }).where(eq(documents.id, docId));
    await stuck(1);
    expect(await code(extract(shipmentId, docId))).toBe("INVALID_STATE");
    await stuck(10);
    expect((await extract(shipmentId, docId)).document.status).toBe("EXTRACTED");
  });

  it("refuses an exported shipment", async () => {
    const { shipmentId, ids } = await sampleShipment("SHP-24819");
    await db().update(shipments).set({ status: "EXPORTED" }).where(eq(shipments.id, shipmentId));
    expect(await code(extract(shipmentId, ids.INVOICE ?? ""))).toBe("INVALID_STATE");
  });
});
