import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { DocType } from "@/domain/fields";
import type { ShipmentStatus } from "@/domain/snapshot";
import { AppError } from "@/lib/errors";
import { SAMPLES } from "../../../scripts/sample-data";
import { db, type Db, type Tx } from "../db/client";
import { documents, importers, shipments, suppliers } from "../db/schema";

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

// ── S2 shipment list (PRD §5.1) ─────────────────────────────────────────────────────────────────────────────────

export interface ShipmentListRow {
  id: string;
  ref: string;
  status: ShipmentStatus;
  supplier: string;
  importer: string;
  invoiceNumber: string | null; // as extracted or entered; untrusted text, rendered as text only
  documentCount: number;
  unresolvedIssuesCount: number;
  failedCheckCount: number;
  updatedAt: string; // ISO
}

export interface ShipmentListFilters {
  status?: ShipmentStatus;
  supplierId?: string;
  q?: string;
}

const LIST_LIMIT = 200; // ponytail: no pagination; add keyset paging on updated_at when a desk passes ~200 open shipments

export async function listShipments(filters: ShipmentListFilters): Promise<ShipmentListRow[]> {
  const invoiceNumber = sql<string | null>`(
    select f.value from extracted_fields f join documents d on d.id = f.document_id
    where d.shipment_id = ${shipments.id} and d.superseded_at is null and d.doc_type = 'INVOICE'
      and f.field_key = 'invoiceNumber' and f.line_item_id is null limit 1)`;
  const pattern = filters.q ? `%${filters.q.replace(/[\\%_]/g, "\\$&")}%` : null;

  const rows = await db()
    .select({
      id: shipments.id, ref: shipments.ref, status: shipments.status, supplier: suppliers.name, importer: importers.name,
      invoiceNumber,
      documentCount: sql<number>`(select count(*)::int from documents d where d.shipment_id = ${shipments.id} and d.superseded_at is null)`,
      unresolvedIssuesCount: shipments.unresolvedIssuesCount, failedCheckCount: shipments.failedCheckCount, updatedAt: shipments.updatedAt,
    })
    .from(shipments)
    .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
    .innerJoin(importers, eq(importers.id, shipments.importerId))
    .where(
      and(
        filters.status ? eq(shipments.status, filters.status) : undefined,
        filters.supplierId ? eq(shipments.supplierId, filters.supplierId) : undefined,
        pattern ? or(ilike(shipments.ref, pattern), sql`${invoiceNumber} ilike ${pattern}`) : undefined,
      ),
    )
    .orderBy(desc(shipments.updatedAt))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export const listSuppliers = () =>
  db().select({ id: suppliers.id, name: suppliers.name, countryCode: suppliers.countryCode }).from(suppliers).orderBy(asc(suppliers.name));

export const listImporters = () => db().select({ id: importers.id, name: importers.name }).from(importers).orderBy(asc(importers.name));

/** S3 sample-set picker: the bundled sets (API_SPECS §7.2). */
export const listSampleSets = () => SAMPLES.map((s) => ({ ref: s.ref, title: s.title, documents: s.uploaded.length }));
