import "server-only";
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { applyConfidencePolicy } from "@/domain/confidence";
import { findEvidence, type TextItem } from "@/domain/evidence";
import { HEADER_FIELDS, LINE_FIELDS, type DocType, type FieldDef } from "@/domain/fields";
import { normalizeField } from "@/domain/normalize/field";
import { detectDecimalSeparator } from "@/domain/normalize/number";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { toModelJpeg } from "../ai/images";
import { extractWithChain, selectProviders, type AiError, type CallRecord, type ExtractionProvider } from "../ai/provider";
import type { AiValue, PageExtraction } from "../ai/schemas";
import { db, type Tx } from "../db/client";
import { documentPages, documents, extractedFields, lineItems, shipments, suppliers } from "../db/schema";
import { shipmentStatus, toDocumentDTO, type DocumentDTO, type ShipmentStatusDTO } from "../queries/shipments";
import { blobStore } from "../storage";
import { audit } from "./audit";
import { lockShipment, recomputeShipment } from "./recompute";

const BUDGET_MS = 240_000; // per document, below the route's 300 s limit (ARCHITECTURE §7.2)
const MAX_CONCURRENT_CALLS = 2;
const HEADER: Record<string, FieldDef> = HEADER_FIELDS;
const LINE: Record<string, FieldDef> = LINE_FIELDS;
const TextItems = z.array(z.object({ str: z.string(), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }) })).nullable();

// In-process limit on concurrent model calls; a released slot passes straight to the next waiter.
let active = 0;
const waiting: Array<() => void> = [];
async function withModelSlot<T>(call: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT_CALLS) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await call();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export interface ExtractDeps {
  /** Provider chain for a file (tests inject one); defaults to selectProviders(env(), sha256). */
  providers?: (sha256: string) => ExtractionProvider[];
}

interface PageOut {
  pageNo: number;
  output: PageExtraction;
  provider: ExtractionProvider;
}

const slotKeys = (registry: Record<string, FieldDef>, slot: DocType) => Object.keys(registry).filter((k) => registry[k]?.on[slot]);

/** Step 1: claim the document (ARCHITECTURE §7.2), refusing when a re-extract would discard human edits. */
async function claim(input: ExtractInput) {
  return db().transaction(async (tx) => {
    const [shipment] = await tx.select({ status: shipments.status }).from(shipments).where(eq(shipments.id, input.shipmentId)).for("update");
    if (!shipment) throw new AppError("NOT_FOUND", "Shipment not found");
    if (shipment.status === "EXPORTED") throw new AppError("INVALID_STATE", "Exported shipments are read-only until a manager reopens them");
    const [current] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.shipmentId, input.shipmentId), isNull(documents.supersededAt)));
    if (!current) throw new AppError("NOT_FOUND", "Document not found");

    if (input.force && !input.discardHumanEdits) {
      const [edited] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(extractedFields)
        .where(and(eq(extractedFields.documentId, current.id), ne(extractedFields.status, "UNREVIEWED")));
      if ((edited?.n ?? 0) > 0) throw new AppError("HUMAN_EDITS_EXIST", "People have confirmed or changed fields on this document; re-extracting would discard their work");
    }

    const claimable = or(
      inArray(documents.status, ["UPLOADED", "FAILED"]),
      and(eq(documents.status, "EXTRACTING"), lt(documents.extractionStartedAt, sql`now() - interval '5 minutes'`)),
      input.force ? inArray(documents.status, ["EXTRACTED", "MANUAL"]) : sql`false`,
    );
    const [claimed] = await tx
      .update(documents)
      .set({ status: "EXTRACTING", extractionStartedAt: sql`now()`, errorCode: null, errorMessage: null })
      .where(and(eq(documents.id, current.id), claimable))
      .returning();
    if (!claimed) throw new AppError("INVALID_STATE", current.status === "EXTRACTING" ? "Extraction is already running" : "This document is already extracted; re-extract it explicitly");

    await recomputeShipment(tx, input.shipmentId, input.actorId);
    await audit(tx, { actorId: input.actorId, action: "EXTRACTION_STARTED", entityType: "document", entityId: claimed.id, shipmentId: input.shipmentId, metadata: { docType: claimed.docType, force: input.force } });
    return claimed;
  });
}

export interface ExtractInput {
  shipmentId: string;
  documentId: string;
  force: boolean;
  discardHumanEdits: boolean;
  actorId: string;
}

/**
 * API_SPECS §4.2 / ARCHITECTURE §7.2: claim → per-page model calls → merge → normalise → evidence → confidence →
 * persist + recompute. A failed extraction is an outcome, not an error: the document becomes FAILED with its code.
 */
export async function extractDocument(input: ExtractInput, deps: ExtractDeps = {}): Promise<{ document: DocumentDTO; shipment: ShipmentStatusDTO }> {
  const doc = await claim(input);
  const started = performance.now();
  const calls: CallRecord[] = [];
  const failedModels: Array<{ modelId: string; error: AiError }> = [];

  let outcome: { ok: true; pages: PageOut[] } | { ok: false; error: AiError };
  try {
    outcome = await readPages(doc, deps, started, calls, failedModels);
  } catch (e) {
    console.error(JSON.stringify({ event: "extraction_error", documentId: doc.id, name: e instanceof Error ? e.name : typeof e }));
    outcome = { ok: false, error: { code: "AI_UNAVAILABLE", retryable: true, message: "Extraction stopped unexpectedly" } };
  }
  const latencyMs = Math.round(performance.now() - started);
  return outcome.ok
    ? persist(input, doc, outcome.pages, { calls, failedModels, latencyMs })
    : markFailed(input, doc, outcome.error, { calls, latencyMs });
}

/** Steps 2–3: one chain per file, one call per page, within the per-document budget. */
async function readPages(
  doc: typeof documents.$inferSelect,
  deps: ExtractDeps,
  started: number,
  calls: CallRecord[],
  failedModels: Array<{ modelId: string; error: AiError }>,
): Promise<{ ok: true; pages: PageOut[] } | { ok: false; error: AiError }> {
  const providers = (deps.providers ?? ((sha) => selectProviders(env(), sha)))(doc.sha256);
  const needsImage = providers.some((p) => p.mode === "LIVE");
  const pages = await db().select().from(documentPages).where(eq(documentPages.documentId, doc.id)).orderBy(asc(documentPages.pageNo));
  const out: PageOut[] = [];
  for (const page of pages) {
    if (performance.now() - started > BUDGET_MS) return { ok: false, error: { code: "AI_TIMEOUT", retryable: true, message: "Extraction took longer than 240 s" } };
    const jpegBase64 = needsImage ? await toModelJpeg(await blobStore().get(page.imageKey), { grayscale: !doc.hasTextLayer }) : "";
    const chain = await withModelSlot(() => extractWithChain(providers, { slot: doc.docType, pageNo: page.pageNo, pageCount: pages.length, jpegBase64 }));
    calls.push(...chain.calls);
    failedModels.push(...chain.failed);
    if (!chain.result.ok || !chain.provider) return { ok: false, error: chain.result.ok ? { code: "AI_UNAVAILABLE", retryable: true, message: "No provider" } : chain.result.error };
    out.push({ pageNo: page.pageNo, output: chain.result.data, provider: chain.provider });
  }
  return { ok: true, pages: out };
}

type FieldRow = typeof extractedFields.$inferInsert;

/** Steps 4–5: merge pages, then read every value with code (PRD §7), check evidence (§7.3) and cap confidence (§8). */
function buildFields(
  doc: typeof documents.$inferSelect,
  pages: PageOut[],
  textLayers: Map<number, TextItem[] | null>,
  supplierCountry: string | null,
): { header: Omit<FieldRow, "lineItemId">[]; lines: Array<Omit<FieldRow, "lineItemId">[]> } {
  const slot = doc.docType;
  const meta = new Map(pages.map((p) => [p.pageNo, { readable: p.output.pageReadable, issues: p.output.pageIssues }]));
  const firstUnreadable = pages.find((p) => !p.output.pageReadable)?.pageNo;
  const fieldsOf = (o: PageExtraction) => o.fields as Record<string, AiValue>;
  const linesOf = (o: PageExtraction) => ("lineItems" in o ? (o.lineItems as Array<Record<string, AiValue>>) : []);

  // Header: the highest-confidence non-null reading across pages.
  const header = new Map<string, { ai: AiValue; pageNo: number }>();
  for (const key of slotKeys(HEADER, slot)) {
    const candidates = pages.flatMap((p) => {
      const ai = fieldsOf(p.output)[key];
      return ai && ai.text !== null ? [{ ai, pageNo: p.pageNo }] : [];
    });
    candidates.sort((a, b) => b.ai.confidence - a.ai.confidence);
    header.set(key, candidates[0] ?? { ai: { text: null, confidence: 0, bbox: null }, pageNo: firstUnreadable ?? 1 });
  }
  const lineRows = pages.flatMap((p) => linesOf(p.output).map((cells) => ({ cells, pageNo: p.pageNo })));

  const printed = [...header.values()].map((h) => h.ai.text).concat(lineRows.flatMap((l) => Object.values(l.cells).map((c) => c.text)));
  const separator = detectDecimalSeparator(printed.filter((t): t is string => t !== null));

  const row = (key: string, def: FieldDef | undefined, ai: AiValue, pageNo: number): Omit<FieldRow, "lineItemId"> => {
    const kind = def?.kind ?? "TEXT";
    const norm = ai.text === null ? null : normalizeField(kind, ai.text, { separator, supplierCountry });
    const items = textLayers.get(pageNo) ?? null;
    const evidence = ai.text === null ? { evidence: items ? ("NOT_FOUND" as const) : ("NO_TEXT_LAYER" as const) } : findEvidence(kind, ai.text, items, separator);
    const page = meta.get(pageNo) ?? { readable: true, issues: [] };
    const { final, signals } = applyConfidencePolicy(ai.confidence, {
      hasValue: ai.text !== null, required: def?.on[slot] === "R", formatValid: norm?.formatValid ?? true,
      ambiguous: norm?.ambiguous ?? false, unitAssumed: norm?.unitAssumed ?? false, evidence: evidence.evidence, page,
    });
    const value = page.readable ? (norm?.value ?? null) : null; // F7: nothing is taken from an unreadable page
    return {
      shipmentId: doc.shipmentId, documentId: doc.id, fieldKey: key, rawText: ai.text, value, originalAiValue: value,
      modelConfidence: ai.confidence.toFixed(3), confidence: final.toFixed(3), confidenceSignals: signals, pageNo,
      bbox: evidence.evidence === "FOUND" && evidence.box ? evidence.box : ai.bbox, status: "UNREVIEWED",
    };
  };

  return {
    header: slotKeys(HEADER, slot).map((key) => {
      const h = header.get(key) ?? { ai: { text: null, confidence: 0, bbox: null }, pageNo: 1 };
      return row(key, HEADER[key], h.ai, h.pageNo);
    }),
    lines: lineRows.map((l) => slotKeys(LINE, slot).map((key) => row(key, LINE[key], l.cells[key] ?? { text: null, confidence: 0, bbox: null }, l.pageNo))),
  };
}

/** Step 6: replace the document's fields and lines, record the run, recompute — one transaction. */
async function persist(
  input: ExtractInput,
  doc: typeof documents.$inferSelect,
  pages: PageOut[],
  run: { calls: CallRecord[]; failedModels: Array<{ modelId: string; error: AiError }>; latencyMs: number },
) {
  const pageRows = await db().select().from(documentPages).where(eq(documentPages.documentId, doc.id));
  const textLayers = new Map(pageRows.map((p) => [p.pageNo, TextItems.parse(p.textItems ?? null)]));
  const [supplier] = await db()
    .select({ country: suppliers.countryCode })
    .from(shipments)
    .innerJoin(suppliers, eq(suppliers.id, shipments.supplierId))
    .where(eq(shipments.id, doc.shipmentId));
  const fields = buildFields(doc, pages, textLayers, supplier?.country ?? null);

  const allUnreadable = pages.every((p) => !p.output.pageReadable);
  const mode = allUnreadable ? "MANUAL" : pages.some((p) => p.provider.mode === "SAMPLE") ? "SAMPLE" : "LIVE";
  const modelId = [...new Set(pages.map((p) => p.provider.modelId))].join(", ");

  return db().transaction(async (tx: Tx) => {
    await lockShipment(tx, input.shipmentId); // lock order: shipment row first (see lockShipment)
    const [still] = await tx.select({ status: documents.status, supersededAt: documents.supersededAt }).from(documents).where(eq(documents.id, doc.id)).for("update");
    if (!still || still.supersededAt !== null) {
      // Replaced by a newer upload while the model was reading: drop this run.
      return { document: toDocumentDTO({ ...doc, status: "FAILED", errorCode: "AI_UNAVAILABLE" }), shipment: await shipmentStatus(tx, input.shipmentId) };
    }
    await tx.delete(extractedFields).where(eq(extractedFields.documentId, doc.id));
    await tx.delete(lineItems).where(eq(lineItems.documentId, doc.id));
    if (fields.header.length > 0) await tx.insert(extractedFields).values(fields.header.map((f) => ({ ...f, lineItemId: null })));
    for (const [i, cells] of fields.lines.entries()) {
      const [item] = await tx.insert(lineItems).values({ documentId: doc.id, lineNo: i + 1 }).returning({ id: lineItems.id });
      if (item && cells.length > 0) await tx.insert(extractedFields).values(cells.map((f) => ({ ...f, lineItemId: item.id })));
    }
    for (const p of pages) {
      await tx.update(documentPages).set({ readable: p.output.pageReadable, issues: p.output.pageIssues }).where(and(eq(documentPages.documentId, doc.id), eq(documentPages.pageNo, p.pageNo)));
    }
    const [updated] = await tx
      .update(documents)
      .set({
        status: allUnreadable ? "MANUAL" : "EXTRACTED", mode, modelId, aiLatencyMs: run.latencyMs, aiUsage: run.calls,
        rawAiOutput: pages.map((p) => ({ pageNo: p.pageNo, output: p.output })), detectedDocType: pages[0]?.output.detectedDocumentType ?? null,
        extractedAt: sql`now()`, errorCode: null, errorMessage: null,
      })
      .where(eq(documents.id, doc.id))
      .returning();
    await recomputeShipment(tx, input.shipmentId, input.actorId);
    await audit(tx, {
      actorId: input.actorId, action: "EXTRACTION_SUCCEEDED", entityType: "document", entityId: doc.id, shipmentId: input.shipmentId,
      metadata: { mode, modelId, pages: pages.length, lines: fields.lines.length, latencyMs: run.latencyMs, calls: run.calls.length },
    });
    if (run.failedModels.length > 0) {
      await audit(tx, {
        actorId: input.actorId, action: "EXTRACTION_FALLBACK_USED", entityType: "document", entityId: doc.id, shipmentId: input.shipmentId,
        metadata: { failed: run.failedModels.map((f) => `${f.modelId}:${f.error.code}`).join(","), usedModel: modelId },
      });
    }
    if (!updated) throw new Error("document update returned nothing");
    return { document: toDocumentDTO(updated), shipment: await shipmentStatus(tx, input.shipmentId) };
  });
}

async function markFailed(input: ExtractInput, doc: typeof documents.$inferSelect, error: AiError, run: { calls: CallRecord[]; latencyMs: number }) {
  return db().transaction(async (tx) => {
    await lockShipment(tx, input.shipmentId);
    const [updated] = await tx
      .update(documents)
      .set({ status: "FAILED", errorCode: error.code, errorMessage: error.message, aiUsage: run.calls, aiLatencyMs: run.latencyMs })
      .where(and(eq(documents.id, doc.id), isNull(documents.supersededAt)))
      .returning();
    await recomputeShipment(tx, input.shipmentId, input.actorId);
    await audit(tx, { actorId: input.actorId, action: "EXTRACTION_FAILED", entityType: "document", entityId: doc.id, shipmentId: input.shipmentId, metadata: { code: error.code, calls: run.calls.length } });
    return { document: toDocumentDTO(updated ?? { ...doc, status: "FAILED", errorCode: error.code, errorMessage: error.message }), shipment: await shipmentStatus(tx, input.shipmentId) };
  });
}
