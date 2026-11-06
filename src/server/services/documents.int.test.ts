import { and, eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { db } from "../db/client";
import { auditLogs, documentPages, documents, shipments } from "../db/schema";
import { seed } from "../db/seed";
import { originalFile, pageImage, uploadDocument } from "./documents";
import { createSampleShipment } from "./shipments";

process.env.SEED_DEMO_PASSWORD ??= "integration-seed-password"; // test database only
const ACTOR = "int-test";
const sample = (file: string) => readFile(`fixtures/samples/${file}`).then((b) => new Uint8Array(b));
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof AppError ? e.code : String(e)));
const bytesOf = async (body: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(body).arrayBuffer());

beforeAll(async () => {
  await seed(); // importers and suppliers the samples use
});

async function emptyShipment() {
  const { shipmentId } = await createSampleShipment({ sampleRef: "SHP-24819", actorId: ACTOR }); // invoice only
  return shipmentId;
}

describe("uploadDocument (ARCHITECTURE §7.1)", () => {
  it("stores the original and page images, records pages with the text layer, and re-derives status", async () => {
    const shipmentId = await emptyShipment();
    const invoice = await sample("SHP-24811/invoice.pdf");
    const { document, shipment } = await uploadDocument({ shipmentId, docType: "PACKING_LIST", bytes: invoice, filename: "C:\\scans\\pl.pdf", mimeType: "application/pdf", actorId: ACTOR });

    expect(document).toMatchObject({ docType: "PACKING_LIST", status: "UPLOADED", pageCount: 1, hasTextLayer: true, originalFilename: "pl.pdf" });
    expect(shipment.documents.map((d) => d.docType)).toEqual(["INVOICE", "PACKING_LIST"]);
    expect(shipment).toMatchObject({ status: "DRAFT", unresolvedIssuesCount: 3 }); // B/L missing + two documents not extracted

    const [page] = await db().select().from(documentPages).where(eq(documentPages.documentId, document.id));
    expect(page?.imageKey).toBe(`shipments/${shipmentId}/${document.id}/page-1.webp`);
    expect(JSON.stringify(page?.textItems)).toContain("3,120.00");

    const image = await pageImage(document.id, 1);
    expect((await sharp(await bytesOf(image.body)).metadata()).format).toBe("webp");
    const original = await originalFile(document.id);
    expect(await bytesOf(original.body)).toEqual(invoice);
    expect([original.contentType, original.filename]).toEqual(["application/pdf", "pl.pdf"]);
  });

  it("supersedes the slot's current document on re-upload (A-23)", async () => {
    const shipmentId = await emptyShipment();
    const [first] = await db().select().from(documents).where(eq(documents.shipmentId, shipmentId));
    const { document } = await uploadDocument({ shipmentId, docType: "INVOICE", bytes: await sample("SHP-24819/invoice.pdf"), filename: "invoice-v2.pdf", mimeType: "application/pdf", actorId: ACTOR });

    const rows = await db().select().from(documents).where(and(eq(documents.shipmentId, shipmentId), eq(documents.docType, "INVOICE")));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first?.id)?.supersededAt).not.toBeNull();
    expect(rows.find((r) => r.id === document.id)?.supersededAt).toBeNull();
    const actions = (await db().select().from(auditLogs).where(eq(auditLogs.shipmentId, shipmentId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["SHIPMENT_CREATED", "DOCUMENT_UPLOADED", "DOCUMENT_SUPERSEDED"]));
  });

  it("refuses an exported shipment and stores nothing", async () => {
    const shipmentId = await emptyShipment();
    await db().update(shipments).set({ status: "EXPORTED" }).where(eq(shipments.id, shipmentId));
    const before = await db().select().from(documents).where(eq(documents.shipmentId, shipmentId));
    expect(await code(uploadDocument({ shipmentId, docType: "PACKING_LIST", bytes: await sample("SHP-24811/packing-list.pdf"), filename: "pl.pdf", mimeType: "application/pdf", actorId: ACTOR }))).toBe("INVALID_STATE");
    expect(await db().select().from(documents).where(eq(documents.shipmentId, shipmentId))).toHaveLength(before.length);
  });

  it("rejects a PNG named .pdf before storing anything", async () => {
    const shipmentId = await emptyShipment();
    expect(await code(uploadDocument({ shipmentId, docType: "BILL_OF_LADING", bytes: await sample("SHP-24813/bill-of-lading.png"), filename: "bl.pdf", mimeType: "application/pdf", actorId: ACTOR }))).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("reports a missing page or document as NOT_FOUND", async () => {
    expect(await code(pageImage(crypto.randomUUID(), 1))).toBe("NOT_FOUND");
    expect(await code(originalFile(crypto.randomUUID()))).toBe("NOT_FOUND");
  });
});

describe("createSampleShipment (API_SPECS §5.1)", () => {
  it("creates SHP-248xx with all three sample files for SHP-24811", async () => {
    const result = await createSampleShipment({ sampleRef: "SHP-24811", actorId: ACTOR });
    expect(result.ref).toMatch(/^SHP-\d+$/);
    expect(Object.keys(result.documentIds).sort()).toEqual(["BILL_OF_LADING", "INVOICE", "PACKING_LIST"]);
    const [row] = await db().select().from(shipments).where(eq(shipments.id, result.shipmentId));
    expect(row).toMatchObject({ status: "DRAFT", unresolvedIssuesCount: 3 }); // three uploaded, none extracted yet
  });

  it("uploads only the invoice for SHP-24819", async () => {
    expect(Object.keys((await createSampleShipment({ sampleRef: "SHP-24819", actorId: ACTOR })).documentIds)).toEqual(["INVOICE"]);
  });

  it("rejects an unknown sample", async () => {
    expect(await code(createSampleShipment({ sampleRef: "SHP-00000", actorId: ACTOR }))).toBe("NOT_FOUND");
  });
});
