import "server-only";
import { eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DocType } from "@/domain/fields";
import { identifierKey, normalizeText } from "@/domain/normalize/text";
import { AppError } from "@/lib/errors";
import { SAMPLES } from "../../../scripts/sample-data";
import { db } from "../db/client";
import { importers, shipments, suppliers } from "../db/schema";
import { audit } from "./audit";
import { uploadDocument } from "./documents";
import { recomputeShipment } from "./recompute";

/**
 * API_SPECS §5.1: a DRAFT shipment with the next ref from shipment_ref_seq (SHP-24820 onwards). Only the seed passes
 * an explicit `ref` (its sample refs are ≤ SHP-24819, ARCHITECTURE §4.2).
 */
export async function createShipment(input: { importerId: string; supplierId: string; actorId: string; ref?: string }): Promise<{ shipmentId: string; ref: string }> {
  return db().transaction(async (tx) => {
    const [importer] = await tx.select({ id: importers.id }).from(importers).where(eq(importers.id, input.importerId));
    const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!importer || !supplier) throw new AppError("NOT_FOUND", !importer ? "Importer not found" : "Supplier not found");

    const ref = input.ref ?? `SHP-${(await tx.execute<{ n: string }>(sql`select nextval('shipment_ref_seq')::text as n`))[0]?.n ?? ""}`;
    const [shipment] = await tx
      .insert(shipments)
      .values({ ref, importerId: importer.id, supplierId: supplier.id, createdBy: input.actorId })
      .returning({ id: shipments.id });
    if (!shipment) throw new Error("shipment insert returned nothing");
    await audit(tx, { actorId: input.actorId, action: "SHIPMENT_CREATED", entityType: "shipment", entityId: shipment.id, shipmentId: shipment.id, metadata: { ref } });
    await recomputeShipment(tx, shipment.id, input.actorId);
    return { shipmentId: shipment.id, ref };
  });
}

// fixtures/samples/manifest.json (API_SPECS §7.3): only the parts this service reads.
const Manifest = z.object({
  samples: z.array(z.object({ ref: z.string(), documents: z.array(z.object({ docType: DocType, file: z.string() })) })),
});

const MIME_BY_EXT: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };

/**
 * API_SPECS §5.1 "Load sample set": a new shipment for the sample's importer and supplier, with the bundled files
 * sent through the normal upload path. The client then starts extraction for each document.
 */
export async function createSampleShipment(input: { sampleRef: string; actorId: string; ref?: string }) {
  const sample = SAMPLES.find((s) => s.ref === input.sampleRef);
  if (!sample) throw new AppError("NOT_FOUND", "Unknown sample set");
  const root = path.join(process.cwd(), "fixtures/samples");
  const manifest = Manifest.parse(JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")));
  const files = manifest.samples.find((s) => s.ref === sample.ref)?.documents ?? [];

  const [importer] = await db().select({ id: importers.id }).from(importers).where(eq(importers.name, sample.importer.name)).limit(1);
  const supplierKey = identifierKey(normalizeText(sample.supplier.name) ?? "");
  const [supplier] = await db().select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.normalizedName, supplierKey));
  if (!importer || !supplier) throw new AppError("NOT_FOUND", "The sample's importer and supplier are not set up; run pnpm db:seed");

  const { shipmentId, ref } = await createShipment({ importerId: importer.id, supplierId: supplier.id, actorId: input.actorId, ref: input.ref });
  const documentIds: Partial<Record<DocType, string>> = {};
  for (const docType of sample.uploaded) {
    const file = files.find((f) => f.docType === docType);
    if (!file) throw new AppError("NOT_FOUND", `Sample file missing for ${docType}; run pnpm samples:generate`);
    const bytes = new Uint8Array(await readFile(path.join(root, file.file)));
    const ext = file.file.split(".").pop() ?? "";
    const { document } = await uploadDocument({
      shipmentId, docType, bytes, filename: path.basename(file.file), mimeType: MIME_BY_EXT[ext] ?? "", actorId: input.actorId,
    });
    documentIds[docType] = document.id;
  }
  return { shipmentId, ref, documentIds };
}
