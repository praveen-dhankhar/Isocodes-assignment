import "server-only";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { db } from "../db/client";
import { importers } from "../db/schema";
import { audit } from "./audit";

/** API_SPECS §5.4: the full contact, once, with a PII_REVEALED audit naming the importer id only. */
export async function revealImporterContact(input: { importerId: string; shipmentId: string | null; actorId: string }) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select({ contactName: importers.contactName, contactEmail: importers.contactEmail, contactPhone: importers.contactPhone }).from(importers).where(eq(importers.id, input.importerId));
    if (!row) throw new AppError("NOT_FOUND", "Importer not found");
    await audit(tx, { actorId: input.actorId, action: "PII_REVEALED", entityType: "importer", entityId: input.importerId, shipmentId: input.shipmentId, metadata: { importerId: input.importerId } });
    return row;
  });
}
