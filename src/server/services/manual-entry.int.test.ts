import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { selectProviders } from "../ai/provider";
import { db } from "../db/client";
import { auditLogs, documentPages, documents, extractedFields, lineItems, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { extractDocument, type ExtractDeps } from "./extraction";
import { addLineItem, dismissWrongType, markPageUnreadable, removeLineItem, startManualEntry } from "./manual-entry";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const ACTOR = "int-test";
const SAMPLE_ONLY: ExtractDeps = {
  providers: (sha) => selectProviders({ EXTRACTION_MODE: "sample", NVIDIA_API_KEY: undefined, NVIDIA_BASE_URL: "", NVIDIA_VLM_MODEL: "", NVIDIA_VLM_FALLBACK_MODEL: "" }, sha),
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const version = async (shipmentId: string) => (await db().select().from(shipments).where(eq(shipments.id, shipmentId)))[0]?.version ?? 0;
const issues = async (shipmentId: string) => (await db().select().from(shipments).where(eq(shipments.id, shipmentId)))[0]?.unresolvedIssuesCount;

beforeAll(async () => {
  await seed();
});

/** SHP-24819 (invoice only), extracted from its recorded sample. */
async function extractedInvoice() {
  const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: "SHP-24819", actorId: ACTOR });
  const documentId = documentIds.INVOICE ?? "";
  await extractDocument({ shipmentId, documentId, force: false, discardHumanEdits: false, actorId: ACTOR }, SAMPLE_ONLY);
  return { shipmentId, documentId };
}

describe("markPageUnreadable (PRD F7)", () => {
  it("clears the page's values to confidence 0, keeps the AI's original, and makes the document MANUAL", async () => {
    const { shipmentId, documentId } = await extractedInvoice();
    const before = await issues(shipmentId);
    const { shipmentVersion } = await markPageUnreadable({ documentId, pageNo: 1, expectedVersion: await version(shipmentId), actorId: ACTOR });
    expect(shipmentVersion).toBe(await version(shipmentId));

    const [total] = await db().select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.fieldKey, "invoiceTotal"), isNull(extractedFields.lineItemId)));
    expect(total).toMatchObject({ value: null, confidence: "0.000", originalAiValue: "4260.00", status: "UNREVIEWED" });
    expect((total?.confidenceSignals as { caps: Array<{ reason: string }> }).caps.map((c) => c.reason)).toContain("PAGE_UNREADABLE");
    expect((await db().select().from(documentPages).where(eq(documentPages.documentId, documentId)))[0]?.readable).toBe(false);
    expect((await db().select().from(documents).where(eq(documents.id, documentId)))[0]?.mode).toBe("MANUAL");
    expect(await issues(shipmentId)).toBeGreaterThan(before ?? 0); // the cleared required fields now block
    expect((await db().select().from(auditLogs).where(eq(auditLogs.entityId, documentId))).map((a) => a.action)).toContain("PAGE_MARKED_UNREADABLE");
  });

  it("refuses a stale version with the current state", async () => {
    const { shipmentId, documentId } = await extractedInvoice();
    const stale = await markPageUnreadable({ documentId, pageNo: 1, expectedVersion: (await version(shipmentId)) - 1, actorId: ACTOR }).catch((e: unknown) => e);
    expect(stale instanceof AppError && stale.code).toBe("VERSION_CONFLICT");
    expect(stale instanceof AppError && (stale.details as { current: { id: string } }).current.id).toBe(shipmentId);
  });

  it("refuses an exported shipment", async () => {
    const { shipmentId, documentId } = await extractedInvoice();
    await db().update(shipments).set({ status: "EXPORTED" }).where(eq(shipments.id, shipmentId));
    expect(await code(markPageUnreadable({ documentId, pageNo: 1, expectedVersion: await version(shipmentId), actorId: ACTOR }))).toBe("INVALID_STATE");
  });
});

describe("manual entry for a document the model could not read", () => {
  it("creates an empty row per slot field; required ones block until entered", async () => {
    const { shipmentId, documentIds } = await createSampleShipment({ sampleRef: "SHP-24819", actorId: ACTOR });
    const documentId = documentIds.INVOICE ?? "";
    await extractDocument({ shipmentId, documentId, force: false, discardHumanEdits: false, actorId: ACTOR }, { providers: () => [] }); // FAILED
    await startManualEntry({ documentId, expectedVersion: await version(shipmentId), actorId: ACTOR });

    const rows = await db().select().from(extractedFields).where(eq(extractedFields.documentId, documentId));
    expect(rows).toHaveLength(12); // every invoice header field
    expect(rows.every((r) => r.value === null && r.originalAiValue === null)).toBe(true);
    expect((await db().select().from(documents).where(eq(documents.id, documentId)))[0]).toMatchObject({ status: "MANUAL", mode: "MANUAL", errorCode: null });
    expect(await code(startManualEntry({ documentId, expectedVersion: await version(shipmentId), actorId: ACTOR }))).toBe("INVALID_STATE");
  });

  it("adds and removes hand-typed lines, but never a line read from the document", async () => {
    const { shipmentId, documentId } = await extractedInvoice();
    const added = await addLineItem({ documentId, expectedVersion: await version(shipmentId), actorId: ACTOR });
    expect(added.lineNo).toBe(2);
    expect(added.fieldIds).toHaveLength(6);
    expect(await code(removeLineItem({ documentId, lineNo: 1, expectedVersion: await version(shipmentId), actorId: ACTOR }))).toBe("INVALID_STATE");
    await removeLineItem({ documentId, lineNo: 2, expectedVersion: await version(shipmentId), actorId: ACTOR });
    expect((await db().select().from(lineItems).where(eq(lineItems.documentId, documentId))).map((l) => l.lineNo)).toEqual([1]);
  });
});

describe("dismissWrongType (PRD F2.4)", () => {
  it("clears the WRONG_DOCUMENT_TYPE issue", async () => {
    const { shipmentId, documentId } = await extractedInvoice();
    await db().update(documents).set({ detectedDocType: "PACKING_LIST" }).where(eq(documents.id, documentId));
    await markPageUnreadable({ documentId, pageNo: 1, expectedVersion: await version(shipmentId), actorId: ACTOR }); // any write recomputes
    const withIssue = await issues(shipmentId);
    await dismissWrongType({ documentId, expectedVersion: await version(shipmentId), actorId: ACTOR });
    expect(await issues(shipmentId)).toBe((withIssue ?? 0) - 1);
  });
});
