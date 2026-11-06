import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DocType } from "@/domain/fields";
import type { ShipmentStatus } from "@/domain/snapshot";
import { AppError } from "@/lib/errors";
import { db, type Db, type Tx } from "../db/client";
import { documents, shipments } from "../db/schema";

// API_SPECS §3 DTOs shared by routes and pages.

export interface DocumentDTO {
  id: string;
  docType: DocType;
  status: "UPLOADED" | "EXTRACTING" | "EXTRACTED" | "FAILED" | "MANUAL";
  mode: "LIVE" | "SAMPLE" | "MANUAL" | null;
  originalFilename: string;
  pageCount: number;
  hasTextLayer: boolean;
  detectedDocType: string | null;
  wrongTypeDismissed: boolean;
  modelId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  extractedAt: string | null; // ISO
}

export interface ShipmentStatusDTO {
  id: string;
  ref: string;
  status: ShipmentStatus;
  version: number;
  unresolvedIssuesCount: number;
  failedCheckCount: number;
  documents: DocumentDTO[]; // current documents only
}

export function toDocumentDTO(d: typeof documents.$inferSelect): DocumentDTO {
  return {
    id: d.id, docType: d.docType, status: d.status, mode: d.mode, originalFilename: d.originalFilename,
    pageCount: d.pageCount, hasTextLayer: d.hasTextLayer, detectedDocType: d.detectedDocType,
    wrongTypeDismissed: d.wrongTypeDismissed, modelId: d.modelId, errorCode: d.errorCode,
    errorMessage: d.errorMessage, extractedAt: d.extractedAt?.toISOString() ?? null,
  };
}

const SLOT_ORDER: Record<DocType, number> = { INVOICE: 0, PACKING_LIST: 1, BILL_OF_LADING: 2 };

export async function shipmentStatus(q: Db | Tx, shipmentId: string): Promise<ShipmentStatusDTO> {
  const [s] = await q.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!s) throw new AppError("NOT_FOUND", "Shipment not found");
  const docs = await q
    .select()
    .from(documents)
    .where(and(eq(documents.shipmentId, shipmentId), isNull(documents.supersededAt)))
    .orderBy(asc(documents.createdAt));
  return {
    id: s.id, ref: s.ref, status: s.status, version: s.version,
    unresolvedIssuesCount: s.unresolvedIssuesCount, failedCheckCount: s.failedCheckCount,
    documents: docs.map(toDocumentDTO).sort((a, b) => SLOT_ORDER[a.docType] - SLOT_ORDER[b.docType]),
  };
}

/** API_SPECS §4.3 polling. */
export const getShipmentStatus = (shipmentId: string) => shipmentStatus(db(), shipmentId);
